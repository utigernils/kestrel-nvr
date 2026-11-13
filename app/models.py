"""Erkennungsmodelle: Katalog, Download, eigene Modelle.

Unterstuetzt werden ONNX-Modelle mit den 80 COCO-Klassen in drei Ausgabeformaten:
YOLOX ([1, N, 85]), YOLOv8/YOLO11 ([1, 84, N]) und End-to-End ([1, N, 6], z. B. YOLO26).

Die YOLOX-Modelle stammen aus dem YOLOX-Projekt (Megvii, Apache-2.0) und werden von dessen
Release 0.1.1rc0 bei GitHub geladen. Die YOLO26-Modelle (Ultralytics, AGPL-3.0) liegen dem Paket
bei - Ultralytics bietet keine fertigen ONNX-Dateien zum Herunterladen an (siehe models/README.md).
"""
from __future__ import annotations

import os
import re
import threading
import urllib.request
from typing import List, Optional

BUNDLED_DIR = "/models" if os.path.isdir("/models") else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models")
_BASE = "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/"

# map = COCO mAP 50:95 laut YOLOX-Projekt; speed = grobe Einordnung auf der CPU
CATALOG = [
    {"id": "yolox_nano", "name": "YOLOX-Nano", "file": "yolox_nano.onnx", "url": _BASE + "yolox_nano.onnx",
     "bytes": 3659407, "input": 416, "map": 25.8, "speed": "fastest", "license": "Apache-2.0"},
    {"id": "yolox_tiny", "name": "YOLOX-Tiny", "file": "yolox_tiny.onnx", "url": _BASE + "yolox_tiny.onnx",
     "bytes": 20219662, "input": 416, "map": 32.8, "speed": "fast", "license": "Apache-2.0"},
    {"id": "yolox_s", "name": "YOLOX-S", "file": "yolox_s.onnx", "url": _BASE + "yolox_s.onnx",
     "bytes": 35858002, "input": 640, "map": 40.5, "speed": "slow", "license": "Apache-2.0"},
    # mitgeliefert (keine Download-Adresse); mAP = End-to-End-Wert laut Ultralytics
    {"id": "yolo26n", "name": "YOLO26n", "file": "yolo26n.onnx", "url": None,
     "bytes": 9942036, "input": 640, "map": 40.1, "speed": "fast", "license": "AGPL-3.0"},
    {"id": "yolo26s", "name": "YOLO26s", "file": "yolo26s.onnx", "url": None,
     "bytes": 38291209, "input": 640, "map": 47.8, "speed": "slow", "license": "AGPL-3.0"},
]
NAME_RE = re.compile(r"[A-Za-z0-9._-]{1,80}\.onnx")
MAX_UPLOAD = 400 * 1024 * 1024


class ModelStore:
    def __init__(self, data_path: str):
        self.user_dir = os.path.join(data_path, "models")
        os.makedirs(self.user_dir, exist_ok=True)
        self.lock = threading.Lock()
        self.download: dict = {"id": None, "received": 0, "total": 0, "error": "", "done": False}

    def path_of(self, file: str) -> Optional[str]:
        """Pfad eines Modells anhand des Dateinamens (eigene Modelle gehen vor)."""
        if not NAME_RE.fullmatch(file or ""):
            return None
        for d in (self.user_dir, BUNDLED_DIR):
            p = os.path.join(d, file)
            if os.path.isfile(p):
                return p
        return None

    def list(self, active_path: str) -> List[dict]:
        out, seen = [], set()
        active = os.path.realpath(active_path) if active_path else ""
        for c in CATALOG:
            p = self.path_of(c["file"])
            seen.add(c["file"])
            if not p and not c["url"]:
                continue                        # mitgeliefertes Modell fehlt in diesem Paket
            out.append({**{k: v for k, v in c.items() if k != "url"}, "custom": False, "installed": bool(p), "path": p,
                        "deletable": bool(p) and p.startswith(self.user_dir),
                        "active": bool(p) and os.path.realpath(p) == active})
        for d in (self.user_dir, BUNDLED_DIR):
            try:
                names = sorted(os.listdir(d))
            except OSError:
                continue
            for n in names:
                if n in seen or not NAME_RE.fullmatch(n):
                    continue
                seen.add(n)
                p = os.path.join(d, n)
                out.append({"id": n, "name": n, "file": n, "bytes": os.path.getsize(p), "custom": True,
                            "installed": True, "path": p, "deletable": d == self.user_dir,
                            "active": os.path.realpath(p) == active})
        if active and not any(m["active"] for m in out):       # Modell von ausserhalb (config.yml)
            out.append({"id": active, "name": os.path.basename(active), "file": os.path.basename(active),
                        "bytes": os.path.getsize(active) if os.path.exists(active) else 0, "custom": True,
                        "installed": os.path.exists(active), "path": active, "deletable": False, "active": True})
        return out

    # ---------------------------------------------------------------- Download
    def start_download(self, model_id: str, validate) -> None:
        entry = next((c for c in CATALOG if c["id"] == model_id), None)
        if not entry or not entry["url"]:
            raise KeyError(model_id)
        with self.lock:
            if self.download["id"] and not self.download["done"]:
                raise RuntimeError("busy")
            self.download = {"id": model_id, "received": 0, "total": entry["bytes"], "error": "", "done": False}
        threading.Thread(target=self._download, args=(entry, validate), daemon=True, name="model-dl").start()

    def _download(self, entry: dict, validate) -> None:
        dest = os.path.join(self.user_dir, entry["file"])
        tmp = dest + ".part"
        st = self.download
        try:
            req = urllib.request.Request(entry["url"], headers={"User-Agent": "Kestrel-NVR"})
            with urllib.request.urlopen(req, timeout=30) as r, open(tmp, "wb") as f:
                while True:
                    chunk = r.read(262144)
                    if not chunk:
                        break
                    f.write(chunk)
                    st["received"] += len(chunk)
            if os.path.getsize(tmp) != entry["bytes"]:
                raise ValueError("size")            # unvollstaendig oder veraendert
            validate(tmp)                           # laesst sich das Modell laden?
            os.replace(tmp, dest)
        except Exception as e:
            st["error"] = "size" if str(e) == "size" else "%s: %s" % (type(e).__name__, e)
            try:
                os.remove(tmp)
            except OSError:
                pass
        finally:
            st["done"] = True

    # ------------------------------------------------------------------ Upload
    def save_upload(self, name: str, chunks, validate) -> str:
        if not NAME_RE.fullmatch(name or ""):
            raise ValueError("name")
        if any(c["file"] == name for c in CATALOG):
            raise ValueError("reserved")
        dest = os.path.join(self.user_dir, name)
        tmp = dest + ".part"
        size = 0
        try:
            with open(tmp, "wb") as f:
                for chunk in chunks:
                    size += len(chunk)
                    if size > MAX_UPLOAD:
                        raise ValueError("too_large")
                    f.write(chunk)
            if size < 1024:
                raise ValueError("empty")
            validate(tmp)
            os.replace(tmp, dest)
            return dest
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass

    def delete(self, file: str, active_path: str) -> None:
        if not NAME_RE.fullmatch(file or ""):
            raise ValueError("name")
        p = os.path.join(self.user_dir, file)
        if not os.path.isfile(p):
            raise FileNotFoundError(file)
        if active_path and os.path.realpath(p) == os.path.realpath(active_path):
            raise ValueError("active")
        os.remove(p)
