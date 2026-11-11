#!/usr/bin/env python3
"""Simulierte MOBOTIX-Kamera zum Testen ohne Hardware.

Liefert unter /control/faststream.jpg einen M-JPEG-Server-Push mit derselben Boundary,
Basic-Auth und absichtlich schwankender Bildrate.

  python3 tools/fake_mobotix.py --port 8081 --user admin --password meinsm
"""
import argparse
import base64
import math
import random
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np

ARGS = None
PERSON = None


def load_person():
    try:
        from skimage import data
        img = cv2.cvtColor(data.astronaut(), cv2.COLOR_RGB2BGR)
        return cv2.resize(img, (300, 300))
    except Exception:
        return None


def render(t: float, w: int, h: int) -> bytes:
    img = np.zeros((h, w, 3), np.uint8)
    img[:] = (52, 44, 38)
    cv2.rectangle(img, (0, int(h * 0.62)), (w, h), (70, 78, 74), -1)
    for i in range(0, w, 160):
        cv2.line(img, (i, int(h * 0.62)), (i - 200, h), (60, 66, 62), 2)
    if PERSON is not None:
        ph, pw = PERSON.shape[:2]
        x = int((math.sin(t / 6.0) * 0.5 + 0.5) * (w - pw - 40)) + 20
        y = int(h * 0.62) - ph + 60
        if (t % 40) < 28:                      # zeitweise ist niemand im Bild
            img[y:y + ph, x:x + pw] = PERSON
    stamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t)) + ".%03d" % (int(t * 1000) % 1000)
    cv2.putText(img, "MOBOTIX M12 (Simulation)  " + stamp, (20, 44), cv2.FONT_HERSHEY_SIMPLEX, 1.0,
                (240, 240, 240), 2, cv2.LINE_AA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return buf.tobytes()


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *a):
        pass

    def do_GET(self):
        if ARGS.user:
            want = "Basic " + base64.b64encode(("%s:%s" % (ARGS.user, ARGS.password)).encode()).decode()
            if self.headers.get("Authorization") != want:
                self.send_response(401)
                self.send_header("WWW-Authenticate", 'Basic realm="MOBOTIX Camera User"')
                self.end_headers()
                return
        if "faststream.jpg" not in self.path:
            data = render(time.time(), ARGS.width, ARGS.height)
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        needlength = "needlength" in self.path
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=MOBOTIX_Fast_Serverpush")
        self.end_headers()
        try:
            while True:
                data = render(time.time(), ARGS.width, ARGS.height)
                head = b"--MOBOTIX_Fast_Serverpush\r\nContent-type: image/jpeg\r\n"
                if needlength:
                    head += b"Content-length: %d\r\n" % len(data)
                self.wfile.write(head + b"\r\n" + data + b"\r\n")
                self.wfile.flush()
                # schwankende Bildrate wie bei einer echten Kamera unter Last
                base = 1.0 / ARGS.fps
                time.sleep(max(0.005, random.uniform(0.4, 1.9) * base))
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8081)
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="meinsm")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=960)
    ap.add_argument("--fps", type=float, default=8)
    ARGS = ap.parse_args()
    PERSON = load_person()
    print("Simulierte Kamera auf Port %d" % ARGS.port)
    ThreadingHTTPServer(("0.0.0.0", ARGS.port), H).serve_forever()
