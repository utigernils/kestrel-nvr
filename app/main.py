"""Kestrel NVR - Web-API und Programmstart."""
from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import os
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import asdict
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config as cfgmod
from .auth import Auth, COOKIE, SESSION_DAYS
from .config import CameraCfg, slug
from .db import DB
from .detector import Detector, COCO, Model
from .events import EventBus
from .models import ModelStore
from .mobotix import MobotixStream, jpeg_size
from .recorder import CameraWorker, probe_stream, with_credentials
from .storage import Storage, MIN

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
log = logging.getLogger("kestrel")
WEB = os.path.join(os.path.dirname(__file__), "web")


def _version() -> str:
    for p in (os.path.join(os.path.dirname(__file__), "..", "VERSION"), "/opt/kestrel/VERSION"):
        try:
            with open(p) as f:
                return f.read().strip()
        except OSError:
            pass
    return "0.0.0"


VERSION = _version()


class Core:
    def __init__(self):
        self.cfg = cfgmod.load()
        self.db = DB(os.path.join(self.cfg.storage.path, "kestrel.db"))
        self.auth = Auth(self.db)
        self.storage = Storage(self.cfg.storage, self.cfg.transcode)
        self.storage.on_prune = self.db.prune
        self.bus = EventBus()
        self.models = ModelStore(self.cfg.storage.path)
        self.workers = {}
        self.detector: Optional[Detector] = None
        self.loop = None
        self.started = time.time()
        self._cpu = (time.time(), time.process_time())
        self._cpu_last = 0.0
        self._bootstrap_admin()

    def _bootstrap_admin(self) -> None:
        """Beim ersten Start das Admin-Konto aus config.yml anlegen und das Klartext-Passwort entfernen."""
        ui = self.cfg.ui
        if not ui.password:
            return
        if self.auth.user_count() == 0:
            try:
                self.auth.create_user(ui.username or "admin", ui.password, "admin")
                log.info("Admin-Konto '%s' angelegt", ui.username or "admin")
            except ValueError as e:
                log.error("Admin-Konto konnte nicht angelegt werden: %s - bitte im Browser einrichten", e)
        ui.username = ui.password = ""
        try:
            self.cfg.save()
        except OSError:
            log.warning("config.yml nicht beschreibbar - bitte ui.password dort von Hand entfernen")

    def start(self, loop) -> None:
        self.loop = loop
        self.bus.loop = loop
        for c in self.cfg.cameras:
            self.start_camera(c)
        threading.Thread(target=self.storage.run_cleanup, daemon=True, name="cleanup").start()
        threading.Thread(target=self.storage.run_transcoder, daemon=True, name="transcoder").start()
        self.detector = Detector(self)
        if self.cfg.detect.enabled and os.path.exists(self.cfg.detect.model):
            self.detector.start()
        elif self.cfg.detect.enabled:
            self.detector.error = "Modelldatei fehlt: %s" % self.cfg.detect.model
            self.detector.error_code = "model_missing"
            log.warning(self.detector.error)

    def use_model(self, path: str) -> None:
        """Erkennungsmodell im laufenden Betrieb wechseln. Wirft eine Ausnahme, wenn es sich nicht laden laesst."""
        model = Model(path, self.cfg.detect.threads)
        self.cfg.detect.model = path
        if self.detector and self.detector.is_alive():
            self.detector.model = model
            self.detector.error = self.detector.error_code = ""
        else:
            self.detector = Detector(self, model)
            if self.cfg.detect.enabled:
                self.detector.start()
        self.cfg.save()

    def start_camera(self, c: CameraCfg) -> None:
        if not c.enabled or c.name in self.workers:
            return
        w = CameraWorker(c, self.storage, self.loop)
        w.detect_on = lambda: bool(self.cfg.detect.enabled and self.detector)
        self.workers[c.name] = w
        w.start()

    def stop_camera(self, name: str) -> None:
        w = self.workers.pop(name, None)
        if w:
            w.stop()

    def stop(self) -> None:
        for name in list(self.workers):
            self.stop_camera(name)
        if self.detector:
            self.detector.stop()
        self.storage.stop()

    def cpu_percent(self) -> float:
        t, p = time.time(), time.process_time()
        t0, p0 = self._cpu
        if t - t0 >= 1.0:
            self._cpu = (t, p)
            self._cpu_last = round((p - p0) / (t - t0) * 100, 1)
        return self._cpu_last


core: Core = None  # type: ignore


@asynccontextmanager
async def lifespan(app: FastAPI):
    global core
    core = Core()
    core.start(asyncio.get_running_loop())
    log.info("Kestrel NVR %s gestartet, %d Kamera(s)", VERSION, len(core.cfg.cameras))
    yield
    core.stop()


app = FastAPI(title="Kestrel NVR", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

# ---------------------------------------------------------------- Zugriffsschutz
PUBLIC = {"/api/auth/me", "/api/auth/login", "/api/auth/setup", "/api/ha/pair/request", "/api/ha/pair/poll"}
SELF_SERVICE = {"/api/auth/logout", "/api/auth/password"}          # darf jeder angemeldete Benutzer
ADMIN_GET = ("/api/config", "/api/users", "/api/integrations", "/api/models")


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


def deny(status: int, code: str, msg: str) -> JSONResponse:
    return JSONResponse({"detail": {"code": code, "message": msg, "params": {}}}, status_code=status)


def fail(status: int, code: str, message: str, **params):
    """Fehler mit Code: die Oberflaeche uebersetzt den Code, `message` ist der deutsche Klartext."""
    raise HTTPException(status, {"code": code, "message": message, "params": params})


def fail_from(e: Exception, status: int = 400):
    fail(status, getattr(e, "code", "invalid"), str(e))


@app.middleware("http")
async def guard(request: Request, call_next):
    path, method = request.url.path, request.method
    if not path.startswith("/api/"):
        resp = await call_next(request)                 # Oberflaeche (HTML/JS/CSS) ist oeffentlich
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
        return resp
    request.state.user = None
    if path.startswith("/api/ha/"):
        if path not in PUBLIC:
            h = request.headers.get("authorization", "")
            client = core.auth.ha_client(h[7:].strip(), client_ip(request)) if h.lower().startswith("bearer ") else None
            if not client:
                return deny(401, "token_invalid", "Ungültiges oder widerrufenes Token")
            if method not in ("GET", "HEAD"):
                return deny(405, "read_only", "Nur Lesezugriff")
            request.state.ha = client
        return await call_next(request)
    # Browser: jede aendernde Anfrage braucht den eigenen Header (Schutz gegen CSRF)
    if method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-kestrel") != "1":
        return deny(403, "csrf", "Anfrage abgelehnt")
    if path not in PUBLIC:
        user = core.auth.session_user(request.cookies.get(COOKIE))
        if not user:
            return deny(401, "not_authenticated", "Nicht angemeldet")
        request.state.user = user
        if user["role"] != "admin":
            if (method not in ("GET", "HEAD") and path not in SELF_SERVICE) or path.startswith(ADMIN_GET):
                return deny(403, "admin_required", "Dafür sind Administratorrechte nötig")
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    return resp


def worker(cam: str) -> CameraWorker:
    w = core.workers.get(cam)
    if not w:
        fail(404, "camera_not_found", "Kamera nicht gefunden")
    return w


def known(cam: str) -> str:
    cam = slug(cam)
    if cam not in core.workers and not os.path.isdir(os.path.join(core.storage.root, cam)):
        fail(404, "camera_not_found", "Kamera nicht gefunden")
    return cam


# ------------------------------------------------------------------- Anmeldung
class LoginIn(BaseModel):
    username: str
    password: str


class PasswordIn(BaseModel):
    current: str
    new: str


class UserIn(BaseModel):
    username: str
    password: str
    role: str = "viewer"


class UserPatch(BaseModel):
    role: Optional[str] = None
    password: Optional[str] = None


def _set_cookie(resp: Response, request: Request, token: str) -> None:
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    resp.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax",
                    secure=secure, path="/")


@app.get("/api/auth/me")
def auth_me(request: Request):
    user = core.auth.session_user(request.cookies.get(COOKIE))
    out = {"user": user, "setup_required": core.auth.user_count() == 0}
    if user:
        out["version"] = VERSION
    return out


@app.post("/api/auth/login")
def auth_login(body: LoginIn, request: Request):
    ip = client_ip(request)
    wait = core.auth.login_limit.blocked(ip)
    if wait > 0:
        fail(429, "login_blocked", "Zu viele Fehlversuche. Bitte %d Sekunden warten." % (int(wait) + 1), seconds=int(wait) + 1)
    user = core.auth.check_login(body.username, body.password)
    if not user:
        core.auth.login_limit.fail(ip)
        log.warning("Fehlgeschlagene Anmeldung von %s", ip)
        fail(401, "bad_credentials", "Benutzername oder Passwort falsch")
    core.auth.login_limit.ok(ip)
    resp = JSONResponse({"user": user, "version": VERSION})
    _set_cookie(resp, request, core.auth.create_session(user["id"], ip, request.headers.get("user-agent", "")))
    return resp


@app.post("/api/auth/setup")
def auth_setup(body: LoginIn, request: Request):
    """Ersteinrichtung im Browser - nur moeglich, solange es noch keinen Benutzer gibt."""
    if core.auth.user_count() > 0:
        fail(403, "setup_done", "Bereits eingerichtet")
    try:
        uid = core.auth.create_user(body.username, body.password, "admin")
    except ValueError as e:
        fail_from(e)
    resp = JSONResponse({"ok": True})
    _set_cookie(resp, request, core.auth.create_session(uid, client_ip(request), request.headers.get("user-agent", "")))
    return resp


@app.post("/api/auth/logout")
def auth_logout(request: Request):
    core.auth.drop_session(request.cookies.get(COOKIE))
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE, path="/")
    return resp


@app.post("/api/auth/password")
def auth_password(body: PasswordIn, request: Request):
    user = request.state.user
    if not core.auth.verify_user_password(user["id"], body.current):
        fail(400, "password_wrong", "Aktuelles Passwort ist falsch")
    try:
        core.auth.update_user(user["id"], password=body.new)
    except ValueError as e:
        fail_from(e)
    resp = JSONResponse({"ok": True})
    _set_cookie(resp, request, core.auth.create_session(user["id"], client_ip(request), request.headers.get("user-agent", "")))
    return resp


@app.get("/api/users")
def users_list():
    return core.auth.users()


@app.post("/api/users")
def users_add(body: UserIn):
    try:
        return {"id": core.auth.create_user(body.username, body.password, body.role)}
    except ValueError as e:
        fail_from(e)


@app.put("/api/users/{uid}")
def users_update(uid: int, body: UserPatch):
    try:
        core.auth.update_user(uid, body.role, body.password)
    except ValueError as e:
        fail_from(e)
    return {"ok": True}


@app.delete("/api/users/{uid}")
def users_delete(uid: int, request: Request):
    if uid == request.state.user["id"]:
        fail(400, "delete_self", "Das eigene Konto kann nicht gelöscht werden")
    try:
        core.auth.delete_user(uid)
    except ValueError as e:
        fail_from(e)
    return {"ok": True}


# ------------------------------------------------------------------ Kameras
def _cameras() -> list:
    out = []
    for c in core.cfg.cameras:
        w = core.workers.get(c.name)
        d = w.stats() if w else {"name": c.name, "host": c.label(), "type": c.type, "codec": "", "state": "deaktiviert", "error": "",
                                 "fps": 0, "kbps": 0, "frames": 0, "viewers": 0, "width": None, "height": None,
                                 "last_ts": None, "uptime": 0, "detect": False}
        d["sensor"] = c.sensor
        out.append(d)
    return out


@app.get("/api/cameras")
def cameras():
    return _cameras()


def _latest(cam: str) -> Response:
    w = worker(cam)
    w.poke_live()
    if w.cfg.type == "rtsp" and w.state == "online":
        # Der Live-Dekoder laeuft nur bei Bedarf: kurz warten, bis ein frisches Bild da ist.
        deadline = time.time() + 8
        while (not w.latest or time.time() * 1000 - w.latest[0] > 3000) and time.time() < deadline:
            time.sleep(0.1)
    if not w.latest:
        fail(503, "no_frame", "Noch kein Bild")
    return Response(w.latest[1], media_type="image/jpeg", headers={"Cache-Control": "no-store"})


def _live(cam: str, fps: float) -> StreamingResponse:
    w = worker(cam)

    async def gen():
        q = w.subscribe()
        last = 0.0
        try:
            item = w.latest
            while True:
                if item:
                    now = time.monotonic()
                    if not fps or now - last >= 1.0 / fps:
                        last = now
                        yield (b"--kestrel\r\nContent-Type: image/jpeg\r\nContent-Length: "
                               + str(len(item[1])).encode() + b"\r\n\r\n" + item[1] + b"\r\n")
                try:
                    item = await asyncio.wait_for(q.get(), timeout=20)
                except asyncio.TimeoutError:
                    item = None
                    if cam not in core.workers:
                        break
        finally:
            w.unsubscribe(q)

    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=kestrel",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@app.get("/api/cameras/{cam}/latest.jpg")
def latest(cam: str):
    return _latest(cam)


@app.get("/api/cameras/{cam}/live.mjpg")
async def live(cam: str, fps: float = 0):
    return _live(cam, fps)


@app.get("/api/cameras/{cam}/index")
def index(cam: str, minute: int):
    cam = known(cam)
    arr = core.storage.index(cam, minute // MIN)
    return {"minute": (minute // MIN) * MIN, "ts": arr["ts"].tolist(), "len": arr["len"].tolist(),
            "codec": core.storage.codec(cam, minute // MIN)}


@app.get("/api/cameras/{cam}/frame/{ts}")
def frame(cam: str, ts: int, download: int = 0):
    cam = known(cam)
    res = core.storage.frame(cam, ts)
    if not res:
        fail(404, "no_frame", "Kein Bild")
    headers = {"Cache-Control": "private, max-age=86400, immutable", "X-Frame-Ts": str(res[0])}
    if download:
        stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(res[0] / 1000))
        headers["Content-Disposition"] = 'attachment; filename="%s_%s_%03d.jpg"' % (cam, stamp, res[0] % 1000)
    return Response(res[1], media_type="image/jpeg", headers=headers)


@app.get("/api/cameras/{cam}/timeline")
def timeline(cam: str, start: int, end: int):
    cam = known(cam)
    end = min(end, start + 8 * 86_400_000)
    return core.storage.timeline(cam, start, end)


@app.get("/api/cameras/{cam}/detections")
def detections(cam: str, start: int, end: int):
    cam = known(cam)
    end = min(end, start + 3_600_000)
    return core.db.detections(cam, start, end)


@app.get("/api/cameras/{cam}/detections/latest")
def detections_latest(cam: str):
    worker(cam)
    ts, dets = core.detector.latest(cam) if core.detector else (0, [])
    return {"ts": ts, "now": int(time.time() * 1000), "dets": dets}


# --------------------------------------------------------------- Ereignisse
@app.get("/api/events")
def events(camera: Optional[str] = None, label: Optional[str] = None, start: Optional[int] = None,
           end: Optional[int] = None, limit: int = 100, after: Optional[int] = None, order: str = "desc"):
    return core.db.events(camera or None, label or None, start, end, limit, after, order == "asc")


def _thumb(eid: int) -> Response:
    data = core.db.thumb(eid)
    if not data:
        raise HTTPException(404)
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=30"})


def _snapshot(eid: int) -> Response:
    data = core.db.snapshot(eid)
    if not data:
        raise HTTPException(404)
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=30"})


@app.get("/api/events/{eid}/thumb.jpg")
def event_thumb(eid: int):
    return _thumb(eid)


@app.get("/api/events/{eid}/snapshot.jpg")
def event_snapshot(eid: int):
    return _snapshot(eid)


@app.get("/api/events/{eid}/preview")
def event_preview(eid: int):
    return {"frames": core.db.event_frames(eid)}


@app.get("/api/events/{eid}/preview/{n}.jpg")
def event_preview_frame(eid: int, n: int):
    data = core.db.event_frame(eid, n)
    if not data:
        raise HTTPException(404)
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@app.delete("/api/events/{eid}")
def event_delete(eid: int):
    core.db.delete_event(eid)
    return {"ok": True}


@app.get("/api/labels")
def labels():
    return core.db.labels()


# ------------------------------------------------------------------- System
def _stats() -> dict:
    try:
        load = os.getloadavg()
    except OSError:
        load = (0, 0, 0)
    return {
        "version": VERSION, "uptime": round(time.time() - core.started),
        "cpu_percent": core.cpu_percent(), "cpu_count": os.cpu_count(), "load": [round(x, 2) for x in load],
        "cameras": [w.stats() for w in core.workers.values()],
        "detector": core.detector.status() if core.detector else None,
        "storage": core.storage.disk(),
    }


@app.get("/api/stats")
def stats():
    return _stats()


@app.get("/api/changelog")
def changelog(lang: str = "en"):
    names = ["CHANGELOG.de.md", "CHANGELOG.md"] if lang == "de" else ["CHANGELOG.md"]
    for name in names:
        for base in (os.path.join(os.path.dirname(__file__), ".."), "/opt/kestrel"):
            try:
                with open(os.path.join(base, name), encoding="utf8") as f:
                    return {"version": VERSION, "markdown": f.read()}
            except OSError:
                pass
    return {"version": VERSION, "markdown": ""}


# ------------------------------------------------------------ Modelle
class ModelSelect(BaseModel):
    file: str


def _check_model(path: str) -> None:
    Model(path, 1)                              # wirft, wenn ONNX Runtime das Modell nicht laden kann


@app.get("/api/models")
def models_list():
    det = core.detector
    return {"models": core.models.list(core.cfg.detect.model), "download": core.models.download,
            "active_path": core.cfg.detect.model,
            "inference_ms": round(det.model.last_ms, 1) if det and det.model else None,
            "kind": det.model.kind if det and det.model else None,
            "input": [det.model.w, det.model.h] if det and det.model else None,
            "error": det.error if det else "", "error_code": det.error_code if det else ""}


@app.post("/api/models/download")
def models_download(body: ModelSelect):
    try:
        core.models.start_download(body.file, _check_model)
    except KeyError:
        fail(404, "model_unknown", "Unbekanntes Modell")
    except RuntimeError:
        fail(409, "model_busy", "Es läuft bereits ein Download")
    return {"ok": True}


@app.put("/api/models/active")
def models_select(body: ModelSelect):
    path = core.models.path_of(body.file)
    if not path:
        fail(404, "model_missing", "Modell nicht gefunden")
    try:
        core.use_model(path)
    except Exception as e:
        fail(400, "model_load", "Modell konnte nicht geladen werden: %s" % e, reason=str(e)[:200])
    log.info("Erkennungsmodell gewechselt: %s", path)
    return {"ok": True}


@app.put("/api/models/upload")
async def models_upload(name: str, request: Request):
    chunks = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > 400 * 1024 * 1024:
            fail(413, "model_too_large", "Datei zu groß (höchstens 400 MB)")
        chunks.append(chunk)

    def save():
        return core.models.save_upload(name, chunks, _check_model)

    try:
        await asyncio.get_running_loop().run_in_executor(None, save)
    except ValueError as e:
        code = {"name": "model_name", "reserved": "model_reserved", "too_large": "model_too_large", "empty": "model_empty"}.get(str(e), "model_load")
        fail(400, code, "Ungültige Modelldatei: %s" % e, reason=str(e)[:200])
    except Exception as e:
        fail(400, "model_load", "Modell konnte nicht geladen werden: %s" % e, reason=str(e)[:200])
    return {"ok": True}


@app.delete("/api/models/{file}")
def models_delete(file: str):
    try:
        core.models.delete(file, core.cfg.detect.model)
    except FileNotFoundError:
        fail(404, "model_missing", "Modell nicht gefunden")
    except ValueError as e:
        fail(400, "model_active" if str(e) == "active" else "model_name", "Das aktive Modell kann nicht gelöscht werden")
    return {"ok": True}


# ------------------------------------------------------------ Einstellungen
class CameraIn(BaseModel):
    name: str
    host: str = ""
    type: str = "mobotix"
    url: str = ""
    sub_url: str = ""
    live_fps: float = 5
    port: int = 80
    scheme: str = "http"
    username: str = ""
    password: str = ""
    sensor: str = "auto"
    fps: float = 0
    extra_params: str = ""
    detect: bool = True


class SettingsIn(BaseModel):
    retention_days: Optional[float] = None
    max_gb: Optional[float] = None
    min_free_gb: Optional[float] = None
    detect_enabled: Optional[bool] = None
    detect_fps: Optional[float] = None
    detect_score: Optional[float] = None
    detect_labels: Optional[list] = None
    motion_gate: Optional[bool] = None
    transcode_enabled: Optional[bool] = None
    transcode_crf: Optional[int] = None
    transcode_threads: Optional[int] = None
    cache_gb: Optional[float] = None
    cache_minutes: Optional[int] = None


@app.get("/api/config")
def get_config():
    c = core.cfg
    return {"cameras": [x.public() for x in c.cameras], "storage": asdict(c.storage),
            "detect": asdict(c.detect), "transcode": asdict(c.transcode), "all_labels": COCO,
            "cpu_count": os.cpu_count()}


def _probe(c: CameraCfg) -> dict:
    if c.type == "mjpeg":
        s = MobotixStream(username=c.username, password=c.password, url=c.url, timeout=8)
    else:
        s = MobotixStream(c.host, c.port, c.username, c.password, c.scheme, c.sensor, c.fps,
                          c.extra_params, timeout=8)
    try:
        s.open()
        t0, n, size = time.time(), 0, None
        for jpeg in s.frames():
            n += 1
            size = size or jpeg_size(jpeg)
            if n >= 6 or time.time() - t0 > 4:
                break
        dt = time.time() - t0
        return {"ok": True, "width": size[0] if size else None, "height": size[1] if size else None,
                "fps": round((n - 1) / dt, 1) if n > 1 and dt > 0 else None, "codec": "mjpeg"}
    except Exception as e:
        return {"ok": False, "error": str(e) or type(e).__name__}
    finally:
        s.close()


def _camera_from(body: CameraIn) -> CameraCfg:
    """Eingabe pruefen; maskierte Passwoerter durch die gespeicherten ersetzen."""
    c = CameraCfg(**body.model_dump())
    c.name = slug(c.name)
    if c.type not in ("mobotix", "mjpeg", "rtsp"):
        fail(400, "camera_type", "Unbekannter Kameratyp")
    if c.sensor not in ("auto", "right", "left", "both"):
        fail(400, "camera_sensor", "Ungültiger Sensor")
    if c.scheme not in ("http", "https"):
        fail(400, "camera_scheme", "Ungültiges Protokoll")
    old = core.cfg.camera(c.name)
    if old:
        if c.password in ("", "********"):
            c.password = old.password
        if "********" in c.url:
            c.url = old.url
        if "********" in c.sub_url:
            c.sub_url = old.sub_url
    c.url, c.sub_url = c.url.strip(), c.sub_url.strip()
    if c.type == "mobotix":
        if not c.host:
            fail(400, "camera_host", "IP-Adresse fehlt")
    else:
        ok = ("http://", "https://") if c.type == "mjpeg" else ("rtsp://", "rtsps://", "http://", "https://", "rtmp://", "srt://", "udp://", "tcp://")
        for u in filter(None, (c.url, c.sub_url)):
            if not u.lower().startswith(ok):
                fail(400, "camera_url_scheme", "Die Adresse muss mit %s beginnen" % " oder ".join(ok[:2]), schemes=" / ".join(ok[:2]))
        if not c.url:
            fail(400, "camera_url", "Adresse des Stroms fehlt")
        c.live_fps = min(30.0, max(0.5, c.live_fps))
    return c


@app.post("/api/cameras/test")
def camera_test(body: CameraIn):
    c = _camera_from(body)
    if c.type == "rtsp":
        return probe_stream(with_credentials(c.url, c.username, c.password))
    return _probe(c)


@app.post("/api/cameras")
def camera_add(body: CameraIn):
    c = _camera_from(body)
    if not c.name:
        fail(400, "camera_name", "Name fehlt")
    old = core.cfg.camera(c.name)
    if old:
        core.stop_camera(c.name)
        core.cfg.cameras[core.cfg.cameras.index(old)] = c
    else:
        core.cfg.cameras.append(c)
    core.cfg.save()
    core.start_camera(c)
    return {"ok": True, "name": c.name}


@app.delete("/api/cameras/{cam}")
def camera_delete(cam: str):
    c = core.cfg.camera(cam)
    if not c:
        raise HTTPException(404)
    core.stop_camera(cam)
    core.cfg.cameras.remove(c)
    core.cfg.save()
    return {"ok": True}


@app.put("/api/settings")
def settings(body: SettingsIn):
    c = core.cfg
    if body.retention_days is not None:
        c.storage.retention_days = max(0.0, body.retention_days)
    if body.max_gb is not None:
        c.storage.max_gb = max(0.0, body.max_gb)
    if body.min_free_gb is not None:
        c.storage.min_free_gb = max(0.5, body.min_free_gb)
    if body.detect_enabled is not None:
        c.detect.enabled = body.detect_enabled
        if body.detect_enabled and core.detector and not core.detector.is_alive() \
                and os.path.exists(c.detect.model):
            core.detector = Detector(core)
            core.detector.start()
    if body.detect_fps is not None:
        c.detect.fps = min(30.0, max(0.1, body.detect_fps))
    if body.detect_score is not None:
        c.detect.score = min(0.95, max(0.05, body.detect_score))
    if body.detect_labels is not None:
        c.detect.labels = [str(x) for x in body.detect_labels]
    if body.motion_gate is not None:
        c.detect.motion_gate = body.motion_gate
    if body.transcode_enabled is not None:
        c.transcode.enabled = body.transcode_enabled
    if body.transcode_crf is not None:
        c.transcode.crf = int(min(40, max(16, body.transcode_crf)))
    if body.transcode_threads is not None:
        c.transcode.threads = int(min(64, max(0, body.transcode_threads)))
    if body.cache_gb is not None:
        c.transcode.cache_gb = max(0.2, body.cache_gb)
    if body.cache_minutes is not None:
        c.transcode.cache_minutes = max(1, body.cache_minutes)
    c.save()
    return {"ok": True}


# ---------------------------------------------- Integrationen (Admin-Seite)
class DecideIn(BaseModel):
    id: str
    allow: bool


@app.get("/api/integrations")
def integrations():
    return {"clients": core.auth.ha_clients(), "pending": core.auth.pair_pending()}


@app.post("/api/integrations/decide")
def integrations_decide(body: DecideIn, request: Request):
    try:
        core.auth.pair_decide(body.id, body.allow, request.state.user["username"])
    except ValueError as e:
        fail_from(e, 404)
    log.info("Kopplungsanfrage %s von %s", "erlaubt" if body.allow else "abgelehnt", request.state.user["username"])
    return {"ok": True}


@app.delete("/api/integrations/{cid}")
def integrations_revoke(cid: int):
    core.auth.ha_revoke(cid)
    return {"ok": True}


# ------------------------------------------------- Home Assistant (Token-API)
class PairIn(BaseModel):
    name: str = "Home Assistant"


class PollIn(BaseModel):
    id: str
    secret: str


@app.post("/api/ha/pair/request")
def ha_pair_request(body: PairIn, request: Request):
    ip = client_ip(request)
    if core.auth.pair_limit.blocked(ip) > 0:
        fail(429, "pair_limit", "Zu viele Anfragen")
    core.auth.pair_limit.fail(ip)               # jede Anfrage zaehlt, Freigabe setzt zurueck
    try:
        out = core.auth.pair_request(body.name, ip)
    except PermissionError as e:
        fail(429, "pair_limit", str(e))
    log.info("Kopplungsanfrage von %s (%s), Code %s", ip, body.name[:60], out["code"])
    out.update({"instance_id": core.auth.instance_id, "version": VERSION, "name": "Kestrel NVR"})
    return out


@app.post("/api/ha/pair/poll")
def ha_pair_poll(body: PollIn, request: Request):
    out = core.auth.pair_poll(body.id, body.secret)
    if out["status"] == "approved":
        core.auth.pair_limit.ok(client_ip(request))
    return out


@app.get("/api/ha/state")
def ha_state():
    active = {}
    for e in core.db.active_events():
        active.setdefault(e["camera"], []).append(e["label"])
    cams = []
    for c in _cameras():
        last = core.db.last_event(c["name"])
        cams.append({"name": c["name"], "state": c["state"], "online": c["state"] == "online",
                     "fps": c["fps"], "kbps": c["kbps"], "width": c["width"], "height": c["height"],
                     "last_frame": c["last_ts"], "active_labels": sorted(set(active.get(c["name"], []))),
                     "last_event": {k: last[k] for k in ("id", "label", "start_ts", "end_ts", "score", "active")} if last else None})
    s = _stats()
    st = s["storage"]
    return {"instance_id": core.auth.instance_id, "version": VERSION, "cameras": cams,
            "system": {"cpu_percent": s["cpu_percent"], "uptime": s["uptime"],
                       "storage_used": st["used"], "disk_free": st["disk_free"], "disk_total": st["disk_total"],
                       "capacity_days": st["capacity_days"], "recording_paused": st["paused"],
                       "storage_warning": st["warning"],
                       "detector_ms": s["detector"]["inference_ms"] if s["detector"] else None}}


@app.get("/api/ha/cameras/{cam}/latest.jpg")
def ha_latest(cam: str):
    return _latest(cam)


@app.get("/api/ha/cameras/{cam}/live.mjpg")
async def ha_live(cam: str, fps: float = 0):
    return _live(cam, fps)


def _ha_event(e: dict) -> dict:
    return {k: e[k] for k in ("id", "camera", "label", "start_ts", "end_ts", "score", "active", "previews")}


@app.get("/api/ha/events")
def ha_events(camera: Optional[str] = None, label: Optional[str] = None, limit: int = 20):
    return [_ha_event(e) for e in core.db.events(camera or None, label or None, None, None, min(limit, 200))]


@app.get("/api/ha/events/stream")
async def ha_event_stream():
    """Server-Sent Events: meldet Start, Aenderung und Ende von Ereignissen sofort."""

    async def gen():
        q = core.bus.subscribe()
        try:
            yield b": verbunden\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield b": ping\n\n"            # haelt die Verbindung offen
                    continue
                data = {"type": msg["type"], "event": _ha_event(msg["event"])}
                yield ("event: %s\ndata: %s\n\n" % (msg["type"], json.dumps(data))).encode()
        finally:
            core.bus.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@app.get("/api/ha/events/{eid}/snapshot.jpg")
def ha_snapshot(eid: int):
    return _snapshot(eid)


@app.get("/api/ha/events/{eid}/preview")
def ha_preview(eid: int):
    return {"frames": core.db.event_frames(eid)}


@app.get("/api/ha/events/{eid}/preview/{n}.jpg")
def ha_preview_frame(eid: int, n: int):
    return event_preview_frame(eid, n)


@app.get("/api/ha/events/{eid}/thumb.jpg")
def ha_thumb(eid: int):
    return _thumb(eid)


mimetypes.add_type("application/manifest+json", ".webmanifest")


@app.get("/sw.js")
def service_worker():
    # Der Service Worker darf nie aus dem Cache kommen, sonst haengen Browser auf einer alten Version fest.
    return FileResponse(os.path.join(WEB, "sw.js"), media_type="text/javascript",
                        headers={"Cache-Control": "no-cache"})


@app.get("/")
def root():
    return FileResponse(os.path.join(WEB, "index.html"), headers={"Cache-Control": "no-cache"})


app.mount("/", StaticFiles(directory=WEB), name="web")


def run():
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("KESTREL_PORT", "5000")),
                log_level="warning", access_log=False)


if __name__ == "__main__":
    run()
