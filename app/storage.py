"""Bildspeicher.

Pro Kamera und Minute (UTC):
  recordings/<kamera>/<JJJJ-MM-TT>/<HH>/<MM>.idx   pro Bild 16 Byte: Zeit(ms) u64, Offset u32, Laenge u32
  recordings/<kamera>/<JJJJ-MM-TT>/<HH>/<MM>.mjr   frisch: alle JPEGs der Minute hintereinander
  recordings/<kamera>/<JJJJ-MM-TT>/<HH>/<MM>.mkv   nach dem Umkodieren: dieselben Bilder als H.265

Jedes Bild behaelt seinen eigenen Empfangs-Zeitstempel (im Index). Es gibt keine feste Bildrate:
das n-te Bild im Video gehoert zum n-ten Eintrag im Index.

Umkodierung: Ist eine Stunde abgeschlossen, wandelt ein Hintergrund-Thread ihre Minuten mit
ffmpeg/libx265 um - mit niedrigster Prioritaet (nice 19, I/O idle) und begrenzter Thread-Zahl,
damit Aufnahme, Live-Bild und Erkennung Vorrang behalten. Erst wenn die Bildanzahl des Videos
geprueft ist, verschwinden die JPEGs. Zum Ansehen wird eine Minute nach cache/ dekodiert.

Speicherwaechter: laeuft alle 10 s. Wird der Platz knapp, verschwindet zuerst das Aelteste -
notfalls minutenweise auch vom heutigen Tag (Ringpuffer). Die Aufnahme laeuft weiter.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import threading
import time
import zipfile
from collections import OrderedDict
from datetime import datetime, timezone
from typing import List, Optional, Tuple

import numpy as np

from .mobotix import jpeg_size

log = logging.getLogger("storage")

IDX = np.dtype([("ts", "<u8"), ("off", "<u4"), ("len", "<u4")])
OFF = np.dtype([("off", "<u8"), ("len", "<u4")])
MIN = 60_000
HOUR = 3_600_000
LEGACY_ZIP = "archive.zip"           # Archive aus Version 1.1
PAUSE_BELOW = 150e6                  # darunter wird nicht mehr geschrieben
RESUME_ABOVE = 400e6
DEFAULT_RATIO = 0.12                 # Annahme H.265/JPEG, bis genug gemessen ist
FRESH_HOURS = 1.5                    # so lange liegt eine Aufnahme im Schnitt noch als JPEG vor


def _parts(minute: int) -> Tuple[str, str, str]:
    dt = datetime.fromtimestamp(minute * 60, tz=timezone.utc)
    return dt.strftime("%Y-%m-%d"), dt.strftime("%H"), dt.strftime("%M")


def _key_ts(key: str) -> int:
    dt = datetime.strptime(key, "%Y-%m-%d/%H").replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _low_priority() -> None:          # laeuft im Kindprozess vor dem Start von ffmpeg
    try:
        os.nice(19)
    except OSError:
        pass


def split_jpegs(data: bytes) -> np.ndarray:
    """Offsets/Laengen der einzelnen JPEGs in einem zusammenhaengenden M-JPEG-Block."""
    starts = []
    i = data.find(b"\xff\xd8\xff")
    while i >= 0:
        starts.append(i)
        i = data.find(b"\xff\xd8\xff", i + 3)
    out = np.zeros(len(starts), dtype=OFF)
    for n, s in enumerate(starts):
        e = starts[n + 1] if n + 1 < len(starts) else len(data)
        out[n] = (s, e - s)
    return out


class Writer:
    """Schreibt die Bilder einer Kamera. Nur vom Recorder-Thread benutzt."""

    def __init__(self, storage: "Storage", cam: str):
        self.storage, self.cam = storage, cam
        self.minute = -1
        self.data = self.idx = None
        self.off = 0
        self.last_ts = 0

    def write(self, ts: int, jpeg: bytes) -> int:
        if ts <= self.last_ts:
            ts = self.last_ts + 1
        self.last_ts = ts
        if self.storage.paused:                 # Datentraeger voll: Live laeuft weiter, Aufnahme pausiert
            self.close()
            return ts
        minute = ts // MIN
        try:
            if minute != self.minute:
                self.close()
                base = self.storage.base(self.cam, minute)
                os.makedirs(os.path.dirname(base), exist_ok=True)
                self.data = open(base + ".mjr", "ab")
                self.idx = open(base + ".idx", "ab")
                self.off = self.data.tell()
                self.minute = minute
            self.data.write(jpeg)
            self.data.flush()
            self.idx.write(np.array([(ts, self.off, len(jpeg))], dtype=IDX).tobytes())
            self.idx.flush()
        except OSError as e:
            self.close()
            self.storage.write_error(e)
            return ts
        self.off += len(jpeg)
        self.storage.used_bytes += len(jpeg) + 16
        self.storage.written_total += len(jpeg) + 16
        return ts

    def close(self) -> None:
        for f in (self.data, self.idx):
            try:
                if f:
                    f.close()
            except Exception:
                pass
        self.data = self.idx = None
        self.minute = -1


class Storage:
    def __init__(self, cfg, transcode_cfg=None):
        self.cfg = cfg                      # StorageCfg (wird live gelesen)
        self.tcfg = transcode_cfg           # TranscodeCfg oder None
        self.root = os.path.join(cfg.path, "recordings")
        self.cache_root = os.path.join(cfg.path, "cache")
        self.stats_path = os.path.join(cfg.path, "transcode_stats.json")
        os.makedirs(self.root, exist_ok=True)
        shutil.rmtree(self.cache_root, ignore_errors=True)      # Reste vom letzten Lauf
        os.makedirs(self.cache_root, exist_ok=True)
        self._cache: "OrderedDict[tuple, np.ndarray]" = OrderedDict()
        self._offs: "OrderedDict[str, np.ndarray]" = OrderedDict()
        self._lock = threading.Lock()
        self._swap = threading.RLock()      # schuetzt den Wechsel .mjr -> .mkv
        self._xlock = threading.Lock()      # ein Dekodiervorgang zur Zeit
        self.used_bytes = 0
        self.written_total = 0              # JPEG-Daten (werden spaeter umkodiert)
        self.written_final = 0              # bereits komprimierte Videodaten (RTSP-Kameras)
        self.rate_final_bps = 0.0
        self.cache_bytes = 0
        self.backlog_bytes = 0              # JPEG-Daten abgeschlossener Stunden, die noch warten
        self.rate_bps = 0.0                 # aktuelle Schreibrate (Byte/s, JPEG)
        self.oldest_ts: Optional[int] = None
        self.paused = False
        self.warning = ""                   # Klartext (deutsch) fuer Log und Home Assistant
        self.warning_code = ""              # Schluessel + Werte fuer die Uebersetzung in der Oberflaeche
        self.warning_params: dict = {}
        self.transcoding = ""
        self.ffmpeg_ok = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
        self.on_prune = None                # callback(before_ts)
        self._stop = threading.Event()
        self._proc: Optional[subprocess.Popen] = None
        self.tstats = {"minutes": 0, "raw_bytes": 0, "packed_bytes": 0, "skipped": 0, "cpu_seconds": 0.0}
        try:
            with open(self.stats_path) as f:
                self.tstats.update(json.load(f))
        except Exception:
            pass

    def base(self, cam: str, minute: int) -> str:
        d, h, m = _parts(minute)
        return os.path.join(self.root, cam, d, h, m)

    def add_video(self, cam: str, minute: int, src: str, idx: np.ndarray) -> bool:
        """Fertiges Video-Segment einer RTSP-Kamera als Minute ablegen (Index + .mkv)."""
        base = self.base(cam, minute)
        if self.paused:
            os.remove(src)
            return False
        os.makedirs(os.path.dirname(base), exist_ok=True)
        size = os.path.getsize(src)
        with self._swap:
            if os.path.exists(base + ".mkv") or os.path.exists(base + ".mjr"):
                # Zweites Segment in derselben Minute (Neustart der Verbindung): anhaengen
                if not os.path.exists(base + ".mkv") or not self._concat(base + ".mkv", src):
                    os.remove(src)
                    return False
                old = np.fromfile(base + ".idx", dtype=IDX)
                idx = np.concatenate([old, idx])
            else:
                shutil.move(src, base + ".mkv")
            idx.tofile(base + ".idx.tmp")
            os.replace(base + ".idx.tmp", base + ".idx")
            with self._lock:
                self._cache.pop((cam, minute), None)
        self.used_bytes += size
        self.written_final += size
        return True

    @staticmethod
    def _concat(dest: str, extra: str) -> bool:
        lst, out = dest + ".list", dest + ".join.mkv"
        try:
            with open(lst, "w") as f:
                f.write("file '%s'\nfile '%s'\n" % (dest, extra))
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "concat",
                            "-safe", "0", "-i", lst, "-c", "copy", "-f", "matroska", out],
                           check=True, timeout=120, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            os.replace(out, dest)
            os.remove(extra)
            return True
        except (subprocess.SubprocessError, OSError):
            return False
        finally:
            for p in (lst, out):
                try:
                    os.remove(p)
                except OSError:
                    pass

    def write_error(self, e: OSError) -> None:
        if not self.paused:
            log.error("Schreibfehler: %s - Aufnahme pausiert", e)
        self.paused = True
        self.warning = "Aufnahme pausiert: %s" % (e.strerror or e)
        self.warning_code, self.warning_params = "write_error", {"reason": str(e.strerror or e)}

    # --------------------------------------------------------------- lesen
    def index(self, cam: str, minute: int, fresh: bool = False) -> np.ndarray:
        key = (cam, minute)
        closed = minute < (time.time() * 1000) // MIN - 1
        if closed and not fresh:
            with self._lock:
                arr = self._cache.get(key)
                if arr is not None:
                    self._cache.move_to_end(key)
                    return arr
        try:
            arr = np.fromfile(self.base(cam, minute) + ".idx", dtype=IDX)
        except (FileNotFoundError, OSError):
            arr = np.empty(0, dtype=IDX)
        if closed:
            with self._lock:
                self._cache[key] = arr
                while len(self._cache) > 512:
                    self._cache.popitem(last=False)
        return arr

    def codec(self, cam: str, minute: int) -> str:
        base = self.base(cam, minute)
        if os.path.exists(base + ".mjr"):
            return "jpeg"
        if os.path.exists(base + ".mkv"):
            return "video"
        if os.path.exists(os.path.join(os.path.dirname(base), LEGACY_ZIP)):
            return "zip"
        return "none"

    def _cache_path(self, cam: str, minute: int) -> str:
        d, h, m = _parts(minute)
        return os.path.join(self.cache_root, cam, d, h, m + ".mjr")

    def _touch(self, path: str) -> None:
        try:
            os.utime(path)                      # "zuletzt benutzt" fuer das Aufraeumen
        except OSError:
            pass

    def _decoded(self, cam: str, minute: int) -> Optional[Tuple[str, np.ndarray]]:
        """H.265-Minute nach cache/ dekodieren. Liefert (Pfad, Offsets der Bilder)."""
        cpath = self._cache_path(cam, minute)
        with self._lock:
            offs = self._offs.get(cpath)
        if offs is not None and os.path.exists(cpath):
            self._touch(cpath)
            return cpath, offs
        with self._xlock:
            with self._lock:
                offs = self._offs.get(cpath)
            if offs is not None and os.path.exists(cpath):
                return cpath, offs
            src = self.base(cam, minute) + ".mkv"
            if not os.path.exists(src) or not self.ffmpeg_ok:
                return None
            os.makedirs(os.path.dirname(cpath), exist_ok=True)
            if shutil.disk_usage(self.cache_root).free < 600e6:
                self._clean_cache(force=True)
            tmp = cpath + ".tmp"
            try:
                subprocess.run(
                    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", src,
                     "-fps_mode", "passthrough", "-an", "-c:v", "mjpeg", "-q:v", "3", "-f", "mjpeg", tmp],
                    check=True, timeout=300, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                with open(tmp, "rb") as f:
                    offs = split_jpegs(f.read())
                os.replace(tmp, cpath)
            except (subprocess.SubprocessError, OSError) as e:
                log.warning("Dekodieren von %s fehlgeschlagen: %s", src, (getattr(e, "stderr", None) or b"")[-300:] or e)
                try:
                    os.remove(tmp)
                except OSError:
                    pass
                return None
            self.cache_bytes += os.path.getsize(cpath)
            with self._lock:
                self._offs[cpath] = offs
                while len(self._offs) > 400:
                    self._offs.popitem(last=False)
            return cpath, offs

    def _from_zip(self, cam: str, minute: int) -> Optional[str]:
        """Minute aus einem Archiv der Version 1.1 holen (bis es umgewandelt ist)."""
        cpath = self._cache_path(cam, minute) + ".raw"
        if os.path.exists(cpath):
            self._touch(cpath)
            return cpath
        zpath = os.path.join(os.path.dirname(self.base(cam, minute)), LEGACY_ZIP)
        with self._xlock:
            if os.path.exists(cpath):
                return cpath
            try:
                with zipfile.ZipFile(zpath) as z:
                    info = z.getinfo(_parts(minute)[2] + ".mjr")
                    os.makedirs(os.path.dirname(cpath), exist_ok=True)
                    with z.open(info) as src, open(cpath + ".tmp", "wb") as dst:
                        shutil.copyfileobj(src, dst, 1 << 20)
                os.replace(cpath + ".tmp", cpath)
                self.cache_bytes += info.file_size
                return cpath
            except (FileNotFoundError, KeyError, zipfile.BadZipFile, OSError):
                return None

    @staticmethod
    def _pread(path: str, off: int, length: int) -> Optional[bytes]:
        try:
            with open(path, "rb") as f:
                f.seek(off)
                data = f.read(length)
        except OSError:
            return None
        return data if len(data) == length and data[:2] == b"\xff\xd8" else None

    def frame(self, cam: str, ts: int) -> Optional[Tuple[int, bytes]]:
        """Bild mit Zeitstempel <= ts innerhalb derselben Minute."""
        minute = ts // MIN
        arr = self.index(cam, minute)
        i = int(np.searchsorted(arr["ts"], ts, side="right")) - 1 if len(arr) else -1
        if i < 0:
            # Video-Segmente enden nicht exakt an der Minutengrenze: das Bild kann in der Vorminute liegen
            minute -= 1
            arr = self.index(cam, minute)
            i = int(np.searchsorted(arr["ts"], ts, side="right")) - 1 if len(arr) else -1
            if i < 0 or ts - int(arr[i]["ts"]) > 10_000:
                return None
        rec = arr[i]
        base = self.base(cam, minute)
        for _ in (0, 1):                        # 2. Durchgang, falls gerade umgeschaltet wurde
            data = self._pread(base + ".mjr", int(rec["off"]), int(rec["len"]))
            if data is not None:
                return int(rec["ts"]), data
            if os.path.exists(base + ".mkv"):
                dec = self._decoded(cam, minute)
                if dec:
                    path, offs = dec
                    if len(offs):
                        o = offs[min(i, len(offs) - 1)]
                        data = self._pread(path, int(o["off"]), int(o["len"]))
                        if data is not None:
                            return int(rec["ts"]), data
            else:
                zp = self._from_zip(cam, minute)
                if zp:
                    data = self._pread(zp, int(rec["off"]), int(rec["len"]))
                    if data is not None:
                        return int(rec["ts"]), data
        return None

    def timeline(self, cam: str, start: int, end: int) -> List[List[int]]:
        """[[minute_start_ms, bildanzahl], ...] fuer den Zeitraum."""
        out = []
        hour = start // HOUR
        last = end // HOUR
        while hour <= last:
            d, h, _ = _parts(hour * 60)
            p = os.path.join(self.root, cam, d, h)
            try:
                with os.scandir(p) as it:
                    for e in it:
                        if e.name.endswith(".idx"):
                            ms = (hour * 60 + int(e.name[:2])) * MIN
                            if start - MIN < ms <= end:
                                n = e.stat().st_size // 16
                                if n:
                                    out.append([ms, n])
            except (FileNotFoundError, NotADirectoryError, ValueError):
                pass
            hour += 1
        out.sort()
        return out

    # ------------------------------------------------------- Umkodierung
    def _hours(self) -> List[Tuple[str, str]]:
        """Alle Stunden-Ordner als (JJJJ-MM-TT/HH, pfad), aelteste zuerst."""
        res = []
        try:
            cams = [e.path for e in os.scandir(self.root) if e.is_dir()]
        except FileNotFoundError:
            return res
        for cp in cams:
            for de in os.scandir(cp):
                if not de.is_dir():
                    continue
                for he in os.scandir(de.path):
                    if he.is_dir():
                        res.append((de.name + "/" + he.name, he.path))
        res.sort()
        return res

    def _threads(self) -> int:
        n = int(self.tcfg.threads) if self.tcfg else 0
        return n if n > 0 else max(1, (os.cpu_count() or 2) // 2)

    def _save_stats(self) -> None:
        try:
            with open(self.stats_path + ".tmp", "w") as f:
                json.dump(self.tstats, f)
            os.replace(self.stats_path + ".tmp", self.stats_path)
        except OSError:
            pass

    def _uniform(self, mjr: str, arr: np.ndarray) -> bool:
        """Alle Bilder gleich gross? (Tag/Nacht-Wechsel kann die Aufloesung aendern.)"""
        sizes = set()
        try:
            with open(mjr, "rb") as f:
                for i in sorted(set(np.linspace(0, len(arr) - 1, min(len(arr), 12)).astype(int).tolist())):
                    f.seek(int(arr[i]["off"]))
                    sizes.add(jpeg_size(f.read(min(int(arr[i]["len"]), 262144))))
        except OSError:
            return False
        return len(sizes) == 1 and None not in sizes

    def _run(self, cmd: List[str], timeout: float) -> Tuple[int, bytes]:
        """ffmpeg mit niedrigster Prioritaet starten; bricht ab, wenn Kestrel beendet wird."""
        if shutil.which("ionice"):
            cmd = ["ionice", "-c", "3"] + cmd
        self._proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                      preexec_fn=_low_priority)
        try:
            t0 = time.time()
            while True:
                try:
                    _, err = self._proc.communicate(timeout=1)
                    return self._proc.returncode, err or b""
                except subprocess.TimeoutExpired:
                    if self._stop.is_set() or time.time() - t0 > timeout or not (self.tcfg and self.tcfg.enabled):
                        self._proc.kill()
                        self._proc.communicate()
                        return -9, b"abgebrochen"
        finally:
            self._proc = None

    def _transcode_minute(self, cam: str, path: str, mm: str) -> Optional[bool]:
        """True = umkodiert, False = bleibt JPEG (markiert), None = abgebrochen."""
        mjr, idx, out = (os.path.join(path, mm + e) for e in (".mjr", ".idx", ".mkv"))
        skip = os.path.join(path, mm + ".skip")
        try:
            arr = np.fromfile(idx, dtype=IDX)
            raw = os.path.getsize(mjr)
        except OSError:
            return False
        if len(arr) < 2 or not self._uniform(mjr, arr):
            open(skip, "w").close()
            self.tstats["skipped"] += 1
            return False
        n = self._threads()
        tmp = out + ".tmp"
        t0 = time.time()
        rc, err = self._run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
             "-f", "mjpeg", "-framerate", "25", "-i", mjr, "-an",
             "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-fps_mode", "passthrough",
             "-c:v", "libx265", "-preset", str(self.tcfg.preset), "-crf", str(int(self.tcfg.crf)),
             "-pix_fmt", "yuv420p", "-threads", str(n),
             "-x265-params", "log-level=error:pools=%d:frame-threads=1" % n,
             "-f", "matroska", tmp], timeout=1800)
        ok = rc == 0
        if ok:
            try:
                res = subprocess.run(
                    ["ffprobe", "-v", "error", "-count_packets", "-select_streams", "v:0",
                     "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", tmp],
                    capture_output=True, timeout=120, preexec_fn=_low_priority)
                ok = int(res.stdout.strip().split(b",")[0] or 0) == len(arr)
                if not ok:
                    err = b"Bildanzahl stimmt nicht (%s statt %d)" % (res.stdout.strip(), len(arr))
            except (subprocess.SubprocessError, ValueError, OSError) as e:
                ok, err = False, str(e).encode()
        if not ok:
            try:
                os.remove(tmp)
            except OSError:
                pass
            if rc == -9:
                return None
            log.warning("[%s] %s/%s bleibt JPEG: %s", cam, path[-13:], mm, err[-200:].decode("utf8", "replace"))
            open(skip, "w").close()
            self.tstats["skipped"] += 1
            return False
        packed = os.path.getsize(tmp)
        with self._swap:                        # erst Video sichtbar machen, dann JPEGs loeschen
            os.replace(tmp, out)
            os.remove(mjr)
        self.used_bytes -= raw - packed
        self.backlog_bytes = max(0, self.backlog_bytes - raw)
        self.tstats["minutes"] += 1
        self.tstats["raw_bytes"] += raw
        self.tstats["packed_bytes"] += packed
        self.tstats["cpu_seconds"] += time.time() - t0
        return True

    def _unzip_legacy(self, path: str) -> None:
        """Archiv aus Version 1.1 wieder in Minuten-Dateien zerlegen, damit es umkodiert wird."""
        zpath = os.path.join(path, LEGACY_ZIP)
        try:
            with zipfile.ZipFile(zpath) as z:
                need = sum(i.file_size for i in z.infolist())
                if shutil.disk_usage(self.root).free < need + 1.5e9:
                    return
                with self._swap:
                    for info in z.infolist():
                        if info.filename.endswith((".mjr", ".idx")) and "/" not in info.filename:
                            with z.open(info) as src, open(os.path.join(path, info.filename + ".tmp"), "wb") as dst:
                                shutil.copyfileobj(src, dst, 1 << 20)
                            os.replace(os.path.join(path, info.filename + ".tmp"), os.path.join(path, info.filename))
                    os.remove(zpath)
            log.info("Archiv aus Version 1.1 umgewandelt: %s", path)
        except (zipfile.BadZipFile, OSError) as e:
            log.warning("Altes Archiv %s nicht lesbar: %s", zpath, e)

    def transcode_pass(self) -> int:
        if not (self.tcfg and self.tcfg.enabled and self.ffmpeg_ok):
            return 0
        done = 0
        limit = time.time() * 1000 - self.tcfg.delay_minutes * MIN
        for key, path in self._hours():
            if self._stop.is_set() or not self.tcfg.enabled:
                break
            if _key_ts(key) + HOUR > limit:     # Stunde noch nicht abgeschlossen
                continue
            try:
                names = set(os.listdir(path))
                if LEGACY_ZIP in names:
                    self._unzip_legacy(path)
                    names = set(os.listdir(path))
                todo = sorted(n[:2] for n in names if n.endswith(".mjr") and n[:2] + ".skip" not in names)
                if not todo:
                    continue
                cam = os.path.basename(os.path.dirname(os.path.dirname(path)))
                t0, raw0, pk0 = time.time(), self.tstats["raw_bytes"], self.tstats["packed_bytes"]
                for mm in todo:
                    self.transcoding = "%s %s:%s" % (cam, key, mm)
                    if shutil.disk_usage(self.root).free < RESUME_ABOVE:
                        break
                    r = self._transcode_minute(cam, path, mm)
                    if r is None:
                        return done
                    done += 1 if r else 0
                self._save_stats()
                raw, pk = self.tstats["raw_bytes"] - raw0, self.tstats["packed_bytes"] - pk0
                if raw:
                    log.info("[%s] %s nach H.265: %.0f MB -> %.0f MB (%.0f %% gespart) in %.0f s",
                             cam, key, raw / 1e6, pk / 1e6, (1 - pk / raw) * 100, time.time() - t0)
            except Exception:
                log.exception("Umkodieren von %s fehlgeschlagen", path)
            finally:
                self.transcoding = ""
        return done

    def run_transcoder(self) -> None:
        if not self.ffmpeg_ok:
            log.warning("ffmpeg/ffprobe nicht gefunden - Umkodierung nach H.265 ist nicht moeglich")
            return
        self._stop.wait(20)
        while not self._stop.is_set():
            try:
                self.transcode_pass()
            except Exception:
                log.exception("Umkodierlauf fehlgeschlagen")
            self._stop.wait(60)

    def ratio(self) -> Tuple[float, bool]:
        """(Groesse H.265 / Groesse JPEG, gemessen?)"""
        t = self.tstats
        if t["raw_bytes"] > 100e6 and t["packed_bytes"] > 0:
            return min(1.0, t["packed_bytes"] / t["raw_bytes"]), True
        return DEFAULT_RATIO, False

    def _clean_cache(self, force: bool = False) -> None:
        files = []
        for dp, _, fns in os.walk(self.cache_root):
            for fn in fns:
                p = os.path.join(dp, fn)
                try:
                    st = os.stat(p)
                    files.append((st.st_mtime, st.st_size, p))
                except OSError:
                    pass
        files.sort()
        total = sum(f[1] for f in files)
        limit = (self.tcfg.cache_gb if self.tcfg else 2) * 1e9
        max_age = (self.tcfg.cache_minutes if self.tcfg else 30) * 60
        now = time.time()
        for mtime, size, p in files:
            if force or now - mtime > max_age or total > limit:
                if not force and now - mtime < 20:
                    continue                    # wird gerade benutzt
                try:
                    os.remove(p)
                    total -= size
                    with self._lock:
                        self._offs.pop(p, None)
                except OSError:
                    pass
        self.cache_bytes = max(0, total)

    # ---------------------------------------------------------- aufraeumen
    @staticmethod
    def _size(path: str) -> int:
        total = 0
        for dp, _, files in os.walk(path):
            for fn in files:
                try:
                    total += os.path.getsize(os.path.join(dp, fn))
                except OSError:
                    pass
        return total

    def _need_free(self) -> float:
        """So viel Platz soll immer frei sein: Mindestreserve oder 15 Minuten Aufnahme."""
        return max(self.cfg.min_free_gb * 1e9, self.total_bps() * 900, RESUME_ABOVE)

    def _free(self) -> float:
        return shutil.disk_usage(self.root).free

    def _drop_minutes(self, need: float) -> int:
        """Notfall: aelteste Minuten einzeln loeschen (auch von heute), bis genug frei ist."""
        cur_min = int(time.time() * 1000) // MIN
        n = 0
        for key, path in self._hours():
            hour0 = _key_ts(key) // MIN
            try:
                names = sorted(os.listdir(path))
            except OSError:
                continue
            if LEGACY_ZIP in names and hour0 + 60 <= cur_min:
                shutil.rmtree(path, ignore_errors=True)
                n += 1
            else:
                for mm in sorted({f[:2] for f in names if f.endswith((".mjr", ".idx", ".mkv"))}):
                    if hour0 + int(mm) >= cur_min - 1:
                        return n
                    for ext in (".mjr", ".mkv", ".idx", ".skip"):
                        try:
                            os.remove(os.path.join(path, mm + ext))
                        except OSError:
                            pass
                    n += 1
                    if self._free() >= need:
                        return n
            if self._free() >= need:
                return n
        return n

    def cleanup(self) -> None:
        hours = self._hours()
        now = time.time()
        cur_key = datetime.fromtimestamp(now, tz=timezone.utc).strftime("%Y-%m-%d/%H")
        sizes = {p: self._size(p) for _, p in hours}
        total = sum(sizes.values())
        cutoff = now * 1000 - self.cfg.retention_days * 86_400_000 if self.cfg.retention_days > 0 else 0
        max_bytes = self.cfg.max_gb * 1e9 if self.cfg.max_gb > 0 else 0
        need = self._need_free()
        removed = False
        remaining = []
        backlog = 0
        for key, path in hours:
            if key >= cur_key:
                remaining.append(key)
                continue
            too_old = cutoff and _key_ts(key) + HOUR < cutoff
            too_big = max_bytes and total > max_bytes
            low_disk = self._free() < need
            if too_old or too_big or low_disk:
                shutil.rmtree(path, ignore_errors=True)
                total -= sizes[path]
                removed = True
                parent = os.path.dirname(path)
                try:
                    if not os.listdir(parent):
                        os.rmdir(parent)
                except OSError:
                    pass
            else:
                remaining.append(key)
                try:
                    names = set(os.listdir(path))
                    for f in names:
                        if f.endswith(".mjr") and f[:2] + ".skip" not in names:
                            backlog += os.path.getsize(os.path.join(path, f))
                except OSError:
                    pass
        if self._free() < need:                 # nur noch die laufende Stunde uebrig -> minutenweise
            self._clean_cache(force=True)
            if self._free() < need and self._drop_minutes(need):
                removed = True
                total = self._size(self.root)
                log.warning("Datentraeger fast voll: aelteste Minuten geloescht")
        self.used_bytes = total
        self.backlog_bytes = backlog
        self.oldest_ts = _key_ts(min(remaining)) if remaining else None
        if removed:
            with self._lock:
                self._cache.clear()
            log.info("Alte Aufnahmen geloescht, belegt: %.1f GB", total / 1e9)
        if self.on_prune:
            before = self.oldest_ts if self.oldest_ts else int(now * 1000)
            if cutoff:
                before = max(before, int(cutoff) - HOUR)
            self.on_prune(before)

    # ------------------------------------------------- Reichweite / Zustand
    def transcode_active(self) -> bool:
        return bool(self.tcfg and self.tcfg.enabled and self.ffmpeg_ok)

    def total_bps(self) -> float:
        """Was die Kameras gerade liefern (JPEG + bereits komprimiertes Video)."""
        return self.rate_bps + self.rate_final_bps

    def effective_bps(self) -> float:
        """Dauerhafter Platzbedarf pro Sekunde: JPEG schrumpft beim Umkodieren, Video bleibt wie es ist."""
        return self.rate_bps * (self.ratio()[0] if self.transcode_active() else 1.0) + self.rate_final_bps

    def backlog_hours(self) -> float:
        return self.backlog_bytes / (self.rate_bps * 3600) if self.rate_bps > 1000 else 0.0

    def capacity_days(self) -> Optional[float]:
        """Wie viele Tage Verlauf passen auf den Datentraeger?

        JPEG-Kameras: die juengsten Stunden liegen noch in voller Groesse vor, alles Aeltere als
        H.265 (gemessenes Verhaeltnis). RTSP-Kameras liefern bereits komprimiertes Video, das
        unveraendert bleibt. Beides fliesst getrennt ein.
        """
        total = self.total_bps()
        if total < 1000:
            return None
        room = self.used_bytes + self._free() - self._need_free()
        if self.cfg.max_gb > 0:
            room = min(room, self.cfg.max_gb * 1e9)
        room = max(0.0, room)
        if not self.transcode_active() or self.rate_bps < 1:
            return room / (total * 86400)
        fresh_s = (FRESH_HOURS + self.backlog_hours()) * 3600
        extra = self.rate_bps * (1 - self.ratio()[0]) * fresh_s      # Mehrbedarf der noch nicht umkodierten Stunden
        if room <= extra:
            return room / (total * 86400)
        return (room - extra) / (self.effective_bps() * 86400)

    def _update_state(self) -> None:
        free = self._free()
        if free < PAUSE_BELOW:
            if not self.paused:
                log.error("Datentraeger voll (%.0f MB frei) - Aufnahme pausiert", free / 1e6)
            self.paused = True
            self.warning = "Datenträger voll – Aufnahme pausiert, bis wieder Platz frei ist."
            self.warning_code, self.warning_params = "disk_full", {}
            return
        if self.paused and free > RESUME_ABOVE:
            self.paused = False
            log.info("Wieder Platz frei - Aufnahme laeuft weiter")
        if self.paused:
            return
        self.warning, self.warning_code, self.warning_params = "", "", {}
        days = self.capacity_days()
        if days is not None and self.cfg.retention_days > 0 and days < self.cfg.retention_days * 0.9:
            self.warning = ("Der Speicher reicht bei der aktuellen Datenrate nur für etwa %s Verlauf "
                            "(eingestellt: %g Tage). Ältere Aufnahmen werden früher gelöscht."
                            % (("%.1f Tage" % days) if days >= 1 else ("%.0f Stunden" % (days * 24)),
                               self.cfg.retention_days))
            self.warning_code = "capacity"
            self.warning_params = {"days": round(days, 2), "retention": self.cfg.retention_days}
        elif self.transcode_active() and self.backlog_hours() > 6:
            self.warning = ("Die Umkodierung nach H.265 kommt nicht hinterher (%.0f Stunden Rückstand). "
                            "Bis sie aufgeholt hat, belegen Aufnahmen mehr Platz." % self.backlog_hours())
            self.warning_code, self.warning_params = "backlog", {"hours": round(self.backlog_hours())}

    def run_cleanup(self) -> None:
        """Waechter: alle 10 s Platz pruefen, alle 2 min vollstaendig aufraeumen."""
        last_full = 0.0
        last_t, last_w = time.time(), self.written_total
        rate_t, rate_w, rate_f = last_t, last_w, self.written_final
        while not self._stop.is_set():
            try:
                now = time.time()
                if now - rate_t >= 60:
                    r = (self.written_total - rate_w) / (now - rate_t)
                    self.rate_bps = r if self.rate_bps == 0 else self.rate_bps * 0.7 + r * 0.3
                    f = (self.written_final - rate_f) / (now - rate_t)
                    self.rate_final_bps = f if self.rate_final_bps == 0 else self.rate_final_bps * 0.5 + f * 0.5
                    rate_t, rate_w, rate_f = now, self.written_total, self.written_final
                elif self.rate_bps == 0 and now - last_t >= 10 and self.written_total > last_w:
                    self.rate_bps = (self.written_total - last_w) / (now - last_t)
                if now - last_full > 120 or self._free() < self._need_free():
                    self.cleanup()
                    self._clean_cache()
                    last_full = now
                self._update_state()
            except Exception:
                log.exception("Aufraeumen fehlgeschlagen")
            self._stop.wait(10)

    def stop(self) -> None:
        self._stop.set()
        p = self._proc
        if p:
            try:
                p.kill()
            except OSError:
                pass

    def disk(self) -> dict:
        du = shutil.disk_usage(self.root)
        t = self.tstats
        ratio, measured = self.ratio()
        return {"used": self.used_bytes, "disk_total": du.total, "disk_free": du.free,
                "oldest": self.oldest_ts, "rate_bps": round(self.total_bps()), "raw_bps": round(self.rate_bps),
                "effective_bps": round(self.effective_bps()),
                "capacity_days": self.capacity_days(), "paused": self.paused, "warning": self.warning,
                "warning_code": self.warning_code, "warning_params": self.warning_params,
                "cache_bytes": self.cache_bytes,
                "transcode": {"enabled": bool(self.tcfg and self.tcfg.enabled), "available": self.ffmpeg_ok,
                              "current": self.transcoding, "minutes": t["minutes"], "skipped": t["skipped"],
                              "raw_bytes": t["raw_bytes"], "packed_bytes": t["packed_bytes"],
                              "ratio": round(ratio, 4), "ratio_measured": measured,
                              "backlog_bytes": self.backlog_bytes,
                              "backlog_hours": round(self.backlog_hours(), 2),
                              "cpu_seconds": round(t["cpu_seconds"])}}
