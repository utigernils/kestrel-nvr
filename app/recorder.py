"""Ein Thread pro Kamera: Strom lesen, speichern, an Live-Zuschauer verteilen.

Drei Arten von Quellen:

  mobotix  M-JPEG ueber faststream.jpg - der schlanke eigene Client, jedes JPEG geht unveraendert
           auf die Platte (optimiert fuer MOBOTIX).
  mjpeg    Beliebige Kamera mit M-JPEG ueber HTTP (multipart/x-mixed-replace). Gleicher Weg wie
           oben, nur mit frei waehlbarer Adresse.
  rtsp     Moderne Kameras mit H.264/H.265 ueber RTSP (oder jede andere Quelle, die ffmpeg lesen
           kann). Das Video wird NICHT neu kodiert: ffmpeg schneidet den Strom minutenweise in
           Dateien, so wie die Kamera ihn liefert. Fuer Live-Bild und Erkennung entstehen daneben
           einige JPEGs pro Sekunde - aus dem Hauptstrom oder, sparsamer, aus einem Nebenstrom
           in kleiner Aufloesung.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time
from collections import deque
from typing import List, Optional, Tuple
from urllib.parse import quote, urlsplit, urlunsplit

import numpy as np

from .mobotix import MobotixStream, AuthError, jpeg_size
from .storage import IDX, MIN, Storage, Writer

log = logging.getLogger("recorder")


def with_credentials(url: str, username: str, password: str) -> str:
    """Benutzer/Passwort in die Adresse einsetzen, falls sie dort noch nicht stehen."""
    u = urlsplit(url)
    if not username or u.username:
        return url
    host = u.hostname or ""
    if u.port:
        host += ":%d" % u.port
    return urlunsplit((u.scheme, "%s:%s@%s" % (quote(username, safe=""), quote(password, safe=""), host),
                       u.path, u.query, u.fragment))


LIVE_MAX_WIDTH = 1920        # Live-Bild und Erkennung von RTSP-Kameras: hoechstens so breit


def ffmpeg_input(url: str, analyze_us: int = 3000000) -> List[str]:
    args = []
    if url.lower().startswith(("rtsp://", "rtsps://")):
        args += ["-rtsp_transport", "tcp", "-timeout", "10000000"]     # 10 s ohne Daten -> Abbruch
    # Zeitstempel = Empfangszeit: damit traegt jedes Bild seine echte Uhrzeit
    return args + ["-analyzeduration", str(analyze_us), "-use_wallclock_as_timestamps", "1", "-i", url]


def probe_stream(url: str, timeout: float = 25) -> dict:
    """Codec, Aufloesung und Bildrate einer Quelle abfragen."""
    cmd = ["ffprobe", "-v", "error", "-analyzeduration", "3000000"]
    if url.lower().startswith(("rtsp://", "rtsps://")):
        cmd += ["-rtsp_transport", "tcp", "-timeout", "8000000"]
    cmd += ["-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,avg_frame_rate",
            "-of", "json", url]
    try:
        res = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except FileNotFoundError:
        return {"ok": False, "error": "ffprobe ist nicht installiert"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Keine Antwort von der Kamera (Zeitüberschreitung)"}
    try:
        st = json.loads(res.stdout or b"{}").get("streams", [])[0]
    except (ValueError, IndexError):
        err = (res.stderr or b"").decode("utf8", "replace").strip().splitlines()
        return {"ok": False, "error": re.sub(r"://[^@/\s]+@", "://***@", err[-1]) if err else "Kein Videostrom gefunden"}
    fps = None
    try:
        a, b = st.get("avg_frame_rate", "0/0").split("/")
        fps = round(float(a) / float(b), 1) if float(b) else None
    except (ValueError, ZeroDivisionError):
        pass
    return {"ok": True, "width": st.get("width"), "height": st.get("height"), "fps": fps,
            "codec": st.get("codec_name")}


class CameraWorker(threading.Thread):
    def __init__(self, cam_cfg, storage: Storage, loop: Optional[asyncio.AbstractEventLoop]):
        super().__init__(daemon=True, name="cam-" + cam_cfg.name)
        self.cfg = cam_cfg
        self.name_ = cam_cfg.name
        self.storage = storage
        self.loop = loop
        self.stop_evt = threading.Event()
        self.latest: Optional[Tuple[int, bytes]] = None
        self.detect_seen_ts = 0
        self.subs: set = set()
        self.state = "verbinde"
        self.error = ""
        self.connected_since = 0.0
        self.frames_total = 0
        self.bytes_total = 0
        self.size = None
        self.codec = "mjpeg"
        self._win = deque()          # (zeit, bytes) der letzten Sekunden
        self._rec_fps = 0.0          # rtsp: Bildrate und Datenrate des letzten Segments
        self._rec_kbps = 0.0
        self._stream: Optional[MobotixStream] = None
        self._procs: List[subprocess.Popen] = []
        self.detect_on = lambda: True    # wird vom Kern gesetzt: laeuft die Erkennung ueberhaupt?
        self._live_poke = 0.0            # letzter Abruf eines Einzelbildes (RTSP: Live-Bild nur bei Bedarf)
        self.live_running = False

    # ------------------------------------------------------------ live
    def poke_live(self) -> None:
        """Jemand will ein aktuelles Bild - haelt bei RTSP-Kameras den Live-Dekoder am Laufen."""
        self._live_poke = time.time()

    def live_wanted(self) -> bool:
        return bool(self.subs) or (bool(self.cfg.detect) and self.detect_on()) or time.time() - self._live_poke < 30

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=2)
        self.subs.add(q)
        return q

    def unsubscribe(self, q) -> None:
        self.subs.discard(q)

    def _publish(self, item) -> None:        # laeuft im Event-Loop
        for q in list(self.subs):
            if q.full():
                try:
                    q.get_nowait()           # langsame Zuschauer verlieren Bilder, bremsen aber nichts
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(item)

    def _emit(self, ts: int, jpeg: bytes) -> None:
        item = (ts, jpeg)
        self.latest = item
        if self.subs and self.loop:
            self.loop.call_soon_threadsafe(self._publish, item)

    # ----------------------------------------------------------- stats
    def stats(self) -> dict:
        now = time.time()
        win = [w for w in self._win if now - w[0] <= 5.0]
        span = (win[-1][0] - win[0][0]) if len(win) > 1 else 0
        fps = (len(win) - 1) / span if span > 0 else 0.0
        kbps = sum(w[1] for w in win[1:]) * 8 / 1000 / span if span > 0 else 0.0
        if self.cfg.type == "rtsp" and self._rec_fps:      # aufgezeichnet wird der volle Strom, nicht das Live-Bild
            fps, kbps = self._rec_fps, self._rec_kbps
        return {
            "name": self.name_, "host": self.cfg.label(), "type": self.cfg.type, "codec": self.codec,
            "state": self.state, "error": self.error,
            "fps": round(fps, 2), "kbps": round(kbps), "frames": self.frames_total, "viewers": len(self.subs),
            "bytes": self.bytes_total, "width": self.size[0] if self.size else None,
            "height": self.size[1] if self.size else None,
            "last_ts": self.latest[0] if self.latest else None,
            "uptime": round(now - self.connected_since) if self.state == "online" else 0,
            "detect": bool(self.cfg.detect), "viewers": len(self.subs),
        }

    # ------------------------------------------------------------- run
    def stop(self) -> None:
        self.stop_evt.set()
        if self._stream:
            self._stream.close()
        for p in list(self._procs):
            try:
                p.terminate()
            except OSError:
                pass

    def run(self) -> None:
        backoff = 1.0
        while not self.stop_evt.is_set():
            try:
                self.state = "verbinde"
                if self.cfg.type == "rtsp":
                    self._run_video()
                else:
                    self._run_mjpeg()
                backoff = 1.0
            except AuthError as e:
                self.state, self.error = "fehler", str(e)
                backoff = 15.0
            except Exception as e:  # Netzwerkfehler, Timeout, Kamera-Neustart ...
                if not self.stop_evt.is_set():
                    self.state, self.error = "fehler", "%s: %s" % (type(e).__name__, e)
                    log.warning("[%s] %s - neuer Versuch in %.0fs", self.name_, self.error, backoff)
            if self.stop_evt.wait(backoff):
                break
            backoff = min(backoff * 2, 10.0)
        self.state = "gestoppt"

    # ------------------------------------------------- M-JPEG (MOBOTIX & Co.)
    def _run_mjpeg(self) -> None:
        c = self.cfg
        if c.type == "mjpeg":
            stream = MobotixStream(username=c.username, password=c.password, url=c.url)
        else:
            stream = MobotixStream(c.host, c.port, c.username, c.password, c.scheme, c.sensor, c.fps, c.extra_params)
        self._stream = stream
        writer = Writer(self.storage, self.name_)
        try:
            stream.open()
            self.state, self.error = "online", ""
            self.connected_since = time.time()
            self.codec = "mjpeg"
            log.info("[%s] verbunden mit %s%s", self.name_, stream.host, stream.path.split("?")[0])
            for jpeg in stream.frames():
                if self.stop_evt.is_set():
                    break
                now = time.time()
                ts = writer.write(int(now * 1000), jpeg)
                self.frames_total += 1
                self.bytes_total += len(jpeg)
                self._win.append((now, len(jpeg)))
                while self._win and now - self._win[0][0] > 6.0:
                    self._win.popleft()
                if self.frames_total % 50 == 1:
                    self.size = jpeg_size(jpeg) or self.size
                self._emit(ts, jpeg)
        finally:
            stream.close()
            writer.close()

    # ------------------------------------------- Video (RTSP, H.264/H.265 ...)
    def _ingest_dir(self) -> str:
        d = os.path.join(self.storage.cfg.path, "ingest", self.name_)
        os.makedirs(d, exist_ok=True)
        return d

    def _spawn(self, cmd: List[str], pipe: bool) -> subprocess.Popen:
        env = dict(os.environ, TZ="UTC")
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE if pipe else subprocess.DEVNULL,
                             stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, env=env)
        self._procs.append(p)
        return p

    @staticmethod
    def _kill(p: subprocess.Popen) -> None:
        try:
            p.terminate()
            p.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            try:
                p.kill()
            except OSError:
                pass

    def _read_jpegs(self, proc: subprocess.Popen) -> None:
        """JPEGs aus der Ausgabe von ffmpeg lesen (Live-Bild und Erkennung)."""
        buf = bytearray()
        out = proc.stdout
        while not self.stop_evt.is_set():
            chunk = out.read1(262144) if out else b""
            if not chunk:
                break
            buf += chunk
            while True:
                a = buf.find(b"\xff\xd8")
                if a < 0:
                    buf.clear()
                    break
                b = buf.find(b"\xff\xd9", a + 2)
                if b < 0:
                    if a:
                        del buf[:a]
                    break
                jpeg = bytes(buf[a:b + 2])
                del buf[:b + 2]
                now = time.time()
                self._win.append((now, len(jpeg)))
                while self._win and now - self._win[0][0] > 6.0:
                    self._win.popleft()
                self._emit(int(now * 1000), jpeg)

    def _finalize(self, path: str) -> None:
        """Abgeschlossenes Segment: Zeitstempel der Bilder auslesen, als Minute einsortieren."""
        try:
            res = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,size",
                 "-of", "csv=p=0", path], capture_output=True, timeout=120)
            rows = []
            for line in res.stdout.decode("ascii", "replace").splitlines():
                parts = line.strip().strip(",").split(",")
                try:
                    rows.append((float(parts[0]), int(parts[1])))
                except (ValueError, IndexError):
                    continue
            if len(rows) < 2:
                os.remove(path)
                return
            rows.sort()
            pts = np.array([r[0] for r in rows])
            if pts[0] < 1e9:                    # keine Uhrzeit im Strom -> Startzeit aus dem Dateinamen (UTC)
                name = os.path.basename(path)[:14]
                start = time.mktime(time.strptime(name, "%Y%m%d%H%M%S")) - time.timezone
                pts = pts - pts[0] + start
            idx = np.zeros(len(rows), dtype=IDX)
            idx["ts"] = (pts * 1000).astype(np.uint64)
            for i in range(1, len(idx)):         # streng aufsteigend
                if idx["ts"][i] <= idx["ts"][i - 1]:
                    idx["ts"][i] = idx["ts"][i - 1] + 1
            idx["len"] = [min(r[1], 0xFFFFFFFF) for r in rows]
            size = os.path.getsize(path)
            span = (int(idx["ts"][-1]) - int(idx["ts"][0])) / 1000.0
            if self.storage.add_video(self.name_, int(idx["ts"][0]) // MIN, path, idx):
                self.frames_total += len(idx)
                self.bytes_total += size
                if span > 0:
                    self._rec_fps = (len(idx) - 1) / span
                    self._rec_kbps = size * 8 / 1000 / span
        except Exception:
            log.exception("[%s] Segment %s konnte nicht uebernommen werden", self.name_, path)
            try:
                os.remove(path)
            except OSError:
                pass

    def _run_video(self) -> None:
        """RTSP-Kamera: aufzeichnen ohne Neukodierung; Live-Bild nur, solange es jemand braucht.

        Zwei getrennte ffmpeg-Prozesse:
          * Aufnahme: kopiert den Hauptstrom unveraendert in Minuten-Dateien. Dekodiert nichts und
            kostet deshalb fast keine Rechenleistung. Laeuft immer.
          * Live-Bild: dekodiert den Nebenstrom (oder, ohne Nebenstrom, den Hauptstrom) zu einigen
            JPEGs pro Sekunde fuer Live-Ansicht und Erkennung. Laeuft nur, wenn die Erkennung fuer
            diese Kamera an ist oder gerade jemand zusieht - sonst wird gar nicht dekodiert.
        Weil die Prozesse getrennt sind, kann ein haengender Zuschauer die Aufnahme nie bremsen.
        """
        c = self.cfg
        if not shutil.which("ffmpeg"):
            raise RuntimeError("ffmpeg ist nicht installiert")
        url = with_credentials(c.url, c.username, c.password)
        sub = with_credentials(c.sub_url, c.username, c.password) if c.sub_url else ""
        outdir = self._ingest_dir()
        for f in sorted(os.listdir(outdir)):         # Reste eines frueheren Laufs uebernehmen
            self._finalize(os.path.join(outdir, f))

        info = probe_stream(url)
        if not info.get("ok"):
            raise RuntimeError(info.get("error") or "Quelle nicht lesbar")
        self.size = (info["width"], info["height"]) if info.get("width") else None
        self.codec = info.get("codec") or "video"

        base = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin"]
        # Aufnahme: unveraendert (copy) in Minuten-Dateien schneiden
        rec_cmd = base + ffmpeg_input(url) + [
            "-map", "0:v:0", "-c:v", "copy", "-an", "-f", "segment", "-segment_time", "60",
            "-segment_atclocktime", "1", "-segment_format", "matroska", "-strftime", "1",
            os.path.join(outdir, "%Y%m%d%H%M%S.mkv")]
        # Live-Bild: wenige Bilder pro Sekunde, hoechstens LIVE_MAX_WIDTH breit, ohne Pufferung
        live_cmd = base + ["-fflags", "nobuffer", "-flags", "low_delay"] + ffmpeg_input(sub or url, 1000000) + [
            "-map", "0:v:0", "-an", "-vf", "fps=%g,scale='min(%d,iw)':-2" % (max(0.5, c.live_fps), LIVE_MAX_WIDTH),
            "-c:v", "mjpeg", "-q:v", "4", "-f", "mjpeg", "pipe:1"]
        self._procs = []
        main = self._spawn(rec_cmd, pipe=False)
        live: Optional[subprocess.Popen] = None
        live_retry = 0.0
        self.state, self.error = "online", ""
        self.connected_since = time.time()
        log.info("[%s] verbunden (%s %sx%s, Live-Bild aus dem %s)", self.name_, self.codec, info.get("width"),
                 info.get("height"), "Nebenstrom" if sub else "Hauptstrom")
        last_scan = 0.0
        try:
            while not self.stop_evt.is_set() and main.poll() is None:
                now = time.time()
                if live is not None and live.poll() is not None:        # Live-Dekoder beendet
                    self._procs.remove(live)
                    live, live_retry = None, now + 5
                wanted = self.live_wanted()
                if wanted and live is None and now >= live_retry:
                    live = self._spawn(live_cmd, pipe=True)
                    threading.Thread(target=self._read_jpegs, args=(live,), daemon=True).start()
                elif not wanted and live is not None:
                    self._kill(live)
                    self._procs.remove(live)
                    live = None
                self.live_running = live is not None
                if now - last_scan >= 2:
                    last_scan = now
                    files = sorted(os.listdir(outdir))
                    for f in files[:-1]:                 # die juengste Datei wird noch geschrieben
                        self._finalize(os.path.join(outdir, f))
                self.stop_evt.wait(0.5)
        finally:
            self.live_running = False
            for p in self._procs:
                self._kill(p)
            err = b""
            try:
                err = main.stderr.read() if main.stderr else b""
            except (OSError, ValueError):
                pass
            self._procs = []
            for f in sorted(os.listdir(outdir)):
                self._finalize(os.path.join(outdir, f))
        if not self.stop_evt.is_set():
            msg = err.decode("utf8", "replace").strip().splitlines()
            raise RuntimeError(re.sub(r"://[^@/\s]+@", "://***@", msg[-1]) if msg else "Verbindung zur Kamera beendet")
