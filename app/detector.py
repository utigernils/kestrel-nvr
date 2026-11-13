"""Objekterkennung auf der CPU (ONNX Runtime; YOLOX, YOLOv8/11 und End-to-End-Modelle wie YOLO26).

CPU-schonend durch drei Massnahmen:
  1. Es wird nur ein Bruchteil der Bilder analysiert (detect.fps, Standard 2/s).
  2. Das JPEG wird direkt verkleinert dekodiert (DCT-Skalierung 1/2, 1/4, 1/8) - ein
     3-MP-Bild kostet so nur wenige Millisekunden statt eines vollen Dekodiervorgangs.
  3. Bewegungs-Gate: ohne Bildaenderung laeuft das Netz gar nicht.

Die Boxen werden normiert (0..1) gespeichert und passen damit auf das Bild in voller
Aufloesung, das der Player zeigt.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import List, Optional

import cv2
import numpy as np

from .mobotix import jpeg_size

log = logging.getLogger("detector")
cv2.setNumThreads(1)

COCO = ["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
        "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog",
        "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella",
        "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
        "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
        "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
        "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant",
        "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
        "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors",
        "teddy bear", "hair drier", "toothbrush"]


def decode_reduced(jpeg: bytes, target: int = 640) -> Optional[np.ndarray]:
    """JPEG so klein wie moeglich dekodieren, laengste Seite bleibt >= target."""
    size = jpeg_size(jpeg)
    flag = cv2.IMREAD_COLOR
    if size:
        longest = max(size)
        if longest >= target * 8:
            flag = cv2.IMREAD_REDUCED_COLOR_8
        elif longest >= target * 4:
            flag = cv2.IMREAD_REDUCED_COLOR_4
        elif longest >= target * 2:
            flag = cv2.IMREAD_REDUCED_COLOR_2
    return cv2.imdecode(np.frombuffer(jpeg, np.uint8), flag)


def iou(a, b) -> float:
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def nms(boxes: np.ndarray, scores: np.ndarray, thr: float = 0.45) -> List[int]:
    order = scores.argsort()[::-1]
    keep = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        if order.size == 1:
            break
        rest = order[1:]
        xx1 = np.maximum(boxes[i, 0], boxes[rest, 0])
        yy1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        xx2 = np.minimum(boxes[i, 2], boxes[rest, 2])
        yy2 = np.minimum(boxes[i, 3], boxes[rest, 3])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        a = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
        b = (boxes[rest, 2] - boxes[rest, 0]) * (boxes[rest, 3] - boxes[rest, 1])
        order = rest[inter / (a + b - inter + 1e-9) <= thr]
    return keep


class Model:
    def __init__(self, path: str, threads: int = 2):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads = max(1, int(threads))
        so.inter_op_num_threads = 1
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.sess = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
        inp = self.sess.get_inputs()[0]
        self.input_name = inp.name
        shape = inp.shape
        self.h = shape[2] if isinstance(shape[2], int) else 640
        self.w = shape[3] if isinstance(shape[3], int) else 640
        out = self.sess.get_outputs()[0].shape
        self.kind = self._detect_kind(out)
        self._grid = None
        self.last_ms = 0.0
        log.info("Modell %s geladen (%s, %dx%d, %d Threads)", path, self.kind, self.w, self.h, threads)

    @staticmethod
    def _detect_kind(out) -> str:
        """Ausgabeformat am Tensor erkennen.

        yolox   [1, N, 85]   Zellen x (Box, Objekt, 80 Klassen), braucht Gitter + NMS
        yolov8  [1, 84, N]   (Box, 80 Klassen) x Zellen, braucht NMS (YOLOv8, YOLO11, YOLO26 mit NMS)
        e2e     [1, N, 6]    fertige Treffer x1,y1,x2,y2,Sicherheit,Klasse - ohne NMS (YOLO26, YOLOv10)
        """
        if len(out) != 3:
            raise ValueError("unbekanntes Ausgabeformat %s" % (out,))
        a, b = out[1], out[2]
        if b == 6:
            return "e2e"
        if isinstance(a, int) and a < 200 and (not isinstance(b, int) or a < b):
            return "yolov8"
        if isinstance(b, int) and b >= 6:
            return "yolox"
        raise ValueError("unbekanntes Ausgabeformat %s" % (out,))

    def _yolox_grid(self):
        if self._grid is None:
            grids, strides = [], []
            for s in (8, 16, 32):
                hs, ws = self.h // s, self.w // s
                xv, yv = np.meshgrid(np.arange(ws), np.arange(hs))
                grids.append(np.stack((xv, yv), 2).reshape(-1, 2))
                strides.append(np.full((hs * ws, 1), s))
            self._grid = (np.concatenate(grids).astype(np.float32),
                          np.concatenate(strides).astype(np.float32))
        return self._grid

    def infer(self, img: np.ndarray, score_thr: float) -> List[tuple]:
        """Liefert [(label, score, x1, y1, x2, y2)] normiert auf 0..1."""
        t0 = time.perf_counter()
        ih, iw = img.shape[:2]
        r = min(self.h / ih, self.w / iw)
        nh, nw = max(1, int(ih * r)), max(1, int(iw * r))
        canvas = np.full((self.h, self.w, 3), 114, np.uint8)
        canvas[:nh, :nw] = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
        if self.kind == "yolox":
            blob = canvas.transpose(2, 0, 1)[None].astype(np.float32)
        else:
            blob = canvas[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0
        out = self.sess.run(None, {self.input_name: np.ascontiguousarray(blob)})[0][0]
        if self.kind == "e2e":
            res = self._from_e2e(out, score_thr, r, iw, ih)
            self.last_ms = (time.perf_counter() - t0) * 1000
            return res
        if self.kind == "yolox":
            grid, stride = self._yolox_grid()
            xy = (out[:, :2] + grid) * stride
            wh = np.exp(np.clip(out[:, 2:4], -10, 10)) * stride
            cls = out[:, 5:] * out[:, 4:5]
        else:
            out = out.T
            xy, wh, cls = out[:, :2], out[:, 2:4], out[:, 4:]
        ids = cls.argmax(1)
        sc = cls[np.arange(len(ids)), ids]
        m = sc >= score_thr
        res = []
        if m.any():
            xy, wh, ids, sc = xy[m], wh[m], ids[m], sc[m]
            boxes = np.concatenate([xy - wh / 2, xy + wh / 2], 1) / r
            for c in np.unique(ids):
                sel = np.where(ids == c)[0]
                for k in nms(boxes[sel], sc[sel]):
                    b = boxes[sel[k]]
                    x1, y1 = max(0.0, b[0] / iw), max(0.0, b[1] / ih)
                    x2, y2 = min(1.0, b[2] / iw), min(1.0, b[3] / ih)
                    if x2 - x1 > 0.005 and y2 - y1 > 0.005:
                        label = COCO[c] if c < len(COCO) else str(int(c))
                        res.append((label, float(sc[sel[k]]), float(x1), float(y1), float(x2), float(y2)))
        self.last_ms = (time.perf_counter() - t0) * 1000
        return res


    @staticmethod
    def _from_e2e(out: np.ndarray, score_thr: float, r: float, iw: int, ih: int) -> List[tuple]:
        """End-to-End-Ausgabe: die Treffer sind fertig, es bleibt nur das Umrechnen auf 0..1."""
        res = []
        for x1, y1, x2, y2, sc, c in out[out[:, 4] >= score_thr]:
            x1, y1 = max(0.0, x1 / r / iw), max(0.0, y1 / r / ih)
            x2, y2 = min(1.0, x2 / r / iw), min(1.0, y2 / r / ih)
            if x2 - x1 > 0.005 and y2 - y1 > 0.005:
                c = int(c)
                res.append((COCO[c] if 0 <= c < len(COCO) else str(c), float(sc), float(x1), float(y1), float(x2), float(y2)))
        return res


class Track:
    __slots__ = ("label", "box", "hits", "first_ts", "last_ts", "score", "event_id",
                 "anchor", "still_since", "parked", "tid", "prev_n", "prev_ts")
    _next = 1

    def __init__(self, label, box, ts):
        self.label, self.box, self.hits = label, box, 1
        self.first_ts = self.last_ts = ts
        self.score = 0.0
        self.event_id = None
        self.anchor, self.still_since, self.parked = box, ts, False
        self.prev_n, self.prev_ts = 0, 0
        self.tid = Track._next
        Track._next += 1


class CamState:
    def __init__(self):
        self.prev_gray = None
        self.last_run = 0.0          # letzte Pruefung (Bewegung)
        self.last_infer = 0.0
        self.tracks: List[Track] = []
        self.last_dets = (0, [])     # (ts, [[label, score, x1, y1, x2, y2, track]])
        self.motion = False


class Detector(threading.Thread):
    GAP_MS = 15_000                  # so lange ohne Treffer -> Objekt weg

    def __init__(self, core, model: Optional[Model] = None):
        super().__init__(daemon=True, name="detector")
        self.core = core
        self.cfg = core.cfg.detect
        self.model: Optional[Model] = model     # kann im Betrieb ausgetauscht werden
        self.error = ""
        self.states = {}
        self.stop_evt = threading.Event()
        self.runs = 0
        self.skipped = 0
        self.error_code = ""

    def status(self) -> dict:
        return {"enabled": bool(self.cfg.enabled), "loaded": self.model is not None,
                "error": self.error, "error_code": self.error_code, "inference_ms": round(self.model.last_ms, 1) if self.model else None,
                "runs": self.runs, "skipped_no_motion": self.skipped, "model": self.cfg.model,
                "kind": self.model.kind if self.model else None}

    def latest(self, cam: str):
        st = self.states.get(cam)
        return st.last_dets if st else (0, [])

    def stop(self) -> None:
        self.stop_evt.set()

    # ------------------------------------------------------------------
    def run(self) -> None:
        if self.model is None:
            try:
                self.model = Model(self.cfg.model, self.cfg.threads)
            except Exception as e:
                self.error = "Modell konnte nicht geladen werden: %s" % e
                self.error_code = "model_load"
                log.error(self.error)
                return
        while not self.stop_evt.is_set():
            busy = False
            if self.cfg.enabled:
                for name, w in list(self.core.workers.items()):
                    if not w.cfg.detect:
                        continue
                    st = self.states.setdefault(name, CamState())
                    now = time.time()
                    if now - st.last_run < 1.0 / max(0.1, self.cfg.fps):
                        continue
                    item = w.latest
                    if not item or item[0] == w.detect_seen_ts:
                        continue
                    w.detect_seen_ts = item[0]
                    st.last_run = now
                    try:
                        self.process(name, st, item[0], item[1])
                    except Exception:
                        log.exception("[%s] Analyse fehlgeschlagen", name)
                    busy = True
            self.stop_evt.wait(0.01 if busy else 0.05)
        self.close_all()

    def _motion(self, st: CamState, img: np.ndarray) -> bool:
        g = cv2.cvtColor(cv2.resize(img, (128, 96), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
        g = cv2.GaussianBlur(g, (5, 5), 0)
        prev, st.prev_gray = st.prev_gray, g
        if prev is None:
            return True
        changed = np.count_nonzero(cv2.absdiff(prev, g) > 18)
        return changed > g.size * 0.004

    def process(self, cam: str, st: CamState, ts: int, jpeg: bytes) -> None:
        model = self.model                      # lokale Referenz: das Modell darf waehrenddessen wechseln
        img = decode_reduced(jpeg, max(model.w, model.h) * 3 // 2)
        if img is None:
            return
        now = time.time()
        st.motion = self._motion(st, img)
        if self.cfg.motion_gate and not st.motion:
            heartbeat = 3.0 if st.tracks else 60.0     # bekannte Objekte gelegentlich nachpruefen
            if now - st.last_infer < heartbeat:
                self.skipped += 1
                self._expire(cam, st, ts)
                return
        st.last_infer = now
        allowed = set(self.cfg.labels or [])
        dets = [d for d in model.infer(img, self.cfg.score) if not allowed or d[0] in allowed]
        self.runs += 1
        self._track(cam, st, ts, dets, img)

    # ----------------------------------------------------------- Tracking
    def _emit(self, kind: str, eid: int) -> None:
        """Start/Aenderung/Ende an Abonnenten melden (Home Assistant)."""
        bus = getattr(self.core, "bus", None)
        if not bus or not bus.subs:
            return
        ev = self.core.db.event(eid)
        if ev:
            bus.publish(kind, ev)

    @staticmethod
    def _snapshot(img: np.ndarray) -> bytes:
        """Ganzes Bild, hoechstens 960 px breit - fuer Benachrichtigungen."""
        h, w = img.shape[:2]
        s = min(1.0, 960.0 / w)
        small = cv2.resize(img, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA) if s < 1 else img
        ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return buf.tobytes() if ok else b""

    def _thumb(self, img: np.ndarray, box) -> bytes:
        h, w = img.shape[:2]
        x1, y1, x2, y2 = box
        px, py = (x2 - x1) * 0.35, (y2 - y1) * 0.35
        a, b = int(max(0, x1 - px) * w), int(max(0, y1 - py) * h)
        c, d = int(min(1, x2 + px) * w), int(min(1, y2 + py) * h)
        crop = img[b:max(d, b + 2), a:max(c, a + 2)]
        ch, cw = crop.shape[:2]
        s = min(1.0, 360.0 / max(ch, cw))
        if s < 1.0:
            crop = cv2.resize(crop, (max(1, int(cw * s)), max(1, int(ch * s))), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 82])
        return buf.tobytes() if ok else b""

    PREVIEW_MAX = 36

    def _preview(self, t: Track, ts: int, img: np.ndarray) -> None:
        """Kleine Bildfolge zum Ereignis ablegen (fuer die Vorschau in der Ereignisliste).

        Erst jede Sekunde, bei langen Ereignissen in groesseren Abstaenden - so bleibt die Vorschau
        klein und haengt nicht davon ab, ob die Aufnahme noch vorhanden oder schon umkodiert ist.
        """
        if t.prev_n >= self.PREVIEW_MAX:
            return
        gap = 900 if t.prev_n < 12 else 3000 if t.prev_n < 24 else 10000
        if ts - t.prev_ts < gap:
            return
        h, w = img.shape[:2]
        s = min(1.0, 400.0 / w)
        small = cv2.resize(img, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA) if s < 1 else img
        ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 70])
        if ok:
            self.core.db.add_event_frame(t.event_id, t.prev_n, ts, buf.tobytes())
            t.prev_n += 1
            t.prev_ts = ts

    def _track(self, cam, st: CamState, ts, dets, img) -> None:
        db = self.core.db
        free = list(st.tracks)
        rows, live = [], []
        for label, score, x1, y1, x2, y2 in sorted(dets, key=lambda d: -d[1]):
            box = (x1, y1, x2, y2)
            best, best_iou = None, 0.2
            for t in free:
                if t.label == label:
                    v = iou(t.box, box)
                    if v > best_iou:
                        best, best_iou = t, v
            if best is None:
                best = Track(label, box, ts)
                st.tracks.append(best)
            else:
                free.remove(best)
                best.box, best.last_ts = box, ts
                best.hits += 1
                if iou(best.anchor, box) < 0.6:              # hat sich bewegt
                    best.anchor, best.still_since = box, ts
                    if best.parked:
                        best.parked, best.first_ts, best.score = False, ts, 0.0
                        best.prev_n, best.prev_ts = 0, 0
                elif not best.parked and ts - best.still_since > self.cfg.stationary_s * 1000:
                    best.parked = True                       # steht nur noch herum -> Ereignis schliessen
                    if best.event_id:
                        db.update_event(best.event_id, ts, active=0)
                        self._emit("end", best.event_id)
                        best.event_id = None
            t = best
            if not t.parked and t.hits >= 2:
                if t.event_id is None:
                    t.score = score
                    t.event_id = db.create_event(cam, label, t.first_ts, ts, score, ts, box,
                                                 self._thumb(img, box), self._snapshot(img))
                    self._emit("start", t.event_id)
                elif score > t.score + 0.02:
                    t.score = score
                    db.update_event(t.event_id, ts, score, ts, box, self._thumb(img, box), snapshot=self._snapshot(img))
                    self._emit("update", t.event_id)
                else:
                    db.update_event(t.event_id, ts)
                self._preview(t, ts, img)
            rows.append((cam, ts, label, round(score, 3), round(x1, 4), round(y1, 4),
                         round(x2, 4), round(y2, 4), t.tid))
            live.append([label, round(score, 3), x1, y1, x2, y2, t.tid])
        db.add_detections(rows)
        st.last_dets = (ts, live)
        self._expire(cam, st, ts)

    def _expire(self, cam, st: CamState, ts) -> None:
        for t in list(st.tracks):
            if ts - t.last_ts > self.GAP_MS:
                if t.event_id:
                    self.core.db.update_event(t.event_id, t.last_ts, active=0)
                    self._emit("end", t.event_id)
                st.tracks.remove(t)

    def close_all(self) -> None:
        for st in self.states.values():
            for t in st.tracks:
                if t.event_id:
                    self.core.db.update_event(t.event_id, t.last_ts, active=0)
            st.tracks.clear()
