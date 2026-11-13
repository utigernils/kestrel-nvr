"""Konfiguration (YAML) laden, validieren und speichern."""
from __future__ import annotations

import os
import re
import threading
from dataclasses import dataclass, field, asdict
from typing import List

import yaml
from urllib.parse import urlsplit

CONFIG_PATH = os.environ.get("KESTREL_CONFIG", "/config/config.yml")

DEFAULT_LABELS = ["person", "bicycle", "car", "motorcycle", "bus", "truck", "cat", "dog", "bird"]


def mask_url(url: str) -> str:
    """Passwort in einer Adresse (rtsp://benutzer:passwort@host/...) unkenntlich machen."""
    return re.sub(r"(://[^:/@]+):[^@/]+@", r"\1:********@", url or "")


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9_-]+", "_", str(name).strip().lower()).strip("_")
    return s or "kamera"


@dataclass
class CameraCfg:
    name: str
    host: str = ""
    type: str = "mobotix"         # mobotix | mjpeg | rtsp
    url: str = ""                 # mjpeg: http(s)://...   rtsp: rtsp://... (oder jede Quelle, die ffmpeg liest)
    sub_url: str = ""             # rtsp: optionaler Nebenstrom in kleiner Aufloesung fuer Live-Bild und Erkennung
    live_fps: float = 5           # rtsp: Bildrate von Live-Bild/Erkennung
    port: int = 80
    scheme: str = "http"          # http | https
    username: str = ""
    password: str = ""
    sensor: str = "auto"          # auto | right | left | both  (M12D: right = Tag, left = Nacht)
    fps: float = 0                # 0 = so schnell wie die Kamera liefert
    extra_params: str = ""        # z.B. "preview&previewsize=1280x960&quality=90"
    detect: bool = True
    enabled: bool = True

    def public(self) -> dict:
        d = asdict(self)
        d["password"] = "********" if self.password else ""
        d["url"], d["sub_url"] = mask_url(self.url), mask_url(self.sub_url)
        return d

    def label(self) -> str:
        """Adresse fuer die Anzeige (ohne Zugangsdaten)."""
        if self.type == "mobotix" or not self.url:
            return self.host
        return urlsplit(self.url).hostname or self.url


@dataclass
class StorageCfg:
    path: str = "/data"
    retention_days: float = 7
    max_gb: float = 0             # 0 = keine Grenze
    min_free_gb: float = 2


@dataclass
class TranscodeCfg:
    enabled: bool = True          # abgeschlossene Stunden im Hintergrund nach H.265 umkodieren
    crf: int = 26                 # Qualitaet: 22 = hoch, 26 = ausgewogen, 30 = sparsam
    preset: str = "veryfast"      # x265-Preset (schneller = weniger CPU, etwas groessere Dateien)
    threads: int = 0              # 0 = automatisch (halbe Kernzahl, mindestens 1)
    delay_minutes: int = 2        # Wartezeit nach Stundenende
    cache_gb: float = 2           # Platz fuer zum Ansehen dekodierte Minuten
    cache_minutes: int = 30       # so lange bleiben dekodierte Minuten liegen


@dataclass
class DetectCfg:
    enabled: bool = True
    model: str = "/models/yolox_tiny.onnx"
    fps: float = 2                # Analyse-Rate pro Kamera
    threads: int = 2              # CPU-Threads fuer die Inferenz
    score: float = 0.45
    labels: List[str] = field(default_factory=lambda: list(DEFAULT_LABELS))
    motion_gate: bool = True      # nur bei Bewegung analysieren
    stationary_s: int = 60        # so lange unbewegt -> Ereignis endet


@dataclass
class UiCfg:
    # Nur fuer den allerersten Start: daraus wird das Admin-Konto angelegt, danach werden
    # die Felder geleert. Benutzer liegen (gehasht) in der Datenbank.
    username: str = ""
    password: str = ""


@dataclass
class Config:
    cameras: List[CameraCfg] = field(default_factory=list)
    storage: StorageCfg = field(default_factory=StorageCfg)
    detect: DetectCfg = field(default_factory=DetectCfg)
    transcode: TranscodeCfg = field(default_factory=TranscodeCfg)
    ui: UiCfg = field(default_factory=UiCfg)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    def camera(self, name: str):
        for c in self.cameras:
            if c.name == name:
                return c
        return None

    def to_dict(self) -> dict:
        return {
            "cameras": [asdict(c) for c in self.cameras],
            "storage": asdict(self.storage),
            "detect": asdict(self.detect),
            "transcode": asdict(self.transcode),
            "ui": asdict(self.ui),
        }

    def save(self, path: str = CONFIG_PATH) -> None:
        with self._lock:
            tmp = path + ".tmp"
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                yaml.safe_dump(self.to_dict(), f, sort_keys=False, allow_unicode=True)
            os.replace(tmp, path)


def _pick(cls, data: dict):
    names = {f for f in cls.__dataclass_fields__ if not f.startswith("_")}
    return cls(**{k: v for k, v in (data or {}).items() if k in names})


def load(path: str = CONFIG_PATH) -> Config:
    raw = {}
    if os.path.exists(path):
        with open(path) as f:
            raw = yaml.safe_load(f) or {}
    cfg = Config()
    seen = set()
    for c in raw.get("cameras") or []:
        if not c or not (c.get("host") or c.get("url")):
            continue
        cam = _pick(CameraCfg, c)
        cam.name = slug(cam.name)
        cam.port = int(cam.port)
        if cam.type not in ("mobotix", "mjpeg", "rtsp"):
            cam.type = "mobotix"
        cam.username = str(cam.username or "")
        cam.password = str(cam.password or "")
        if cam.name in seen:
            continue
        seen.add(cam.name)
        cfg.cameras.append(cam)
    cfg.storage = _pick(StorageCfg, raw.get("storage"))
    cfg.detect = _pick(DetectCfg, raw.get("detect"))
    cfg.transcode = _pick(TranscodeCfg, raw.get("transcode"))
    cfg.transcode.crf = int(min(40, max(16, cfg.transcode.crf)))
    cfg.ui = _pick(UiCfg, raw.get("ui"))
    cfg.storage.path = os.environ.get("KESTREL_DATA", cfg.storage.path)
    cfg.detect.model = os.environ.get("KESTREL_MODEL", cfg.detect.model)
    return cfg
