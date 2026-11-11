"""MOBOTIX M-JPEG "faststream" Client.

Die Kamera liefert unter /control/faststream.jpg?stream=full einen HTTP-Server-Push
(multipart/x-mixed-replace, Boundary "MOBOTIX_Fast_Serverpush"). Jeder Teil ist ein
vollstaendiges JPEG. Mit dem Parameter "needlength" sendet die Kamera pro Bild einen
Content-Length-Header, damit muss der Strom nicht nach Bildgrenzen durchsucht werden.
fps=0 bedeutet "unbegrenzt": die Kamera sendet so schnell sie kann (variable Bildrate).

Die Bilder werden hier NICHT dekodiert oder neu kodiert - sie gehen Byte fuer Byte so
auf die Platte, wie die Kamera sie erzeugt hat.
"""
from __future__ import annotations

import base64
import hashlib
import http.client
import os
import re
import ssl
from typing import Iterator, Optional, Tuple
from urllib.parse import unquote, urlsplit


class StreamError(Exception):
    pass


class AuthError(StreamError):
    pass


def jpeg_size(b: bytes) -> Optional[Tuple[int, int]]:
    """(Breite, Hoehe) aus dem JPEG-Header lesen, ohne zu dekodieren."""
    i, n = 2, len(b)
    while i + 9 < n:
        if b[i] != 0xFF:
            i += 1
            continue
        m = b[i + 1]
        if m == 0xFF:
            i += 1
            continue
        if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
            return (b[i + 7] << 8 | b[i + 8], b[i + 5] << 8 | b[i + 6])
        if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        i += 2 + (b[i + 2] << 8 | b[i + 3])
    return None


def build_path(username: str, sensor: str = "auto", fps: float = 0, extra: str = "") -> str:
    # /control/... = Benutzerzugang, /cgi-bin/... = Gastzugang (ohne Anmeldung)
    base = "/control/faststream.jpg" if username else "/cgi-bin/faststream.jpg"
    params = ["stream=full", "needlength", "fps=%g" % (fps or 0)]
    if sensor and sensor != "auto":
        params.append("camera=%s" % sensor)
    if extra:
        params.append(extra.lstrip("&?"))
    return base + "?" + "&".join(params)


class MobotixStream:
    def __init__(self, host="", port=80, username="", password="", scheme="http",
                 sensor="auto", fps=0, extra="", timeout=15, url=""):
        self.username, self.password = username, password
        if url:
            # Allgemeine M-JPEG-Kamera: die Adresse wird unveraendert benutzt.
            u = urlsplit(url)
            self.scheme = u.scheme or "http"
            self.host = u.hostname or ""
            self.port = u.port or (443 if self.scheme == "https" else 80)
            self.path = (u.path or "/") + ("?" + u.query if u.query else "")
            if u.username and not username:
                self.username, self.password = unquote(u.username), unquote(u.password or "")
        else:
            # MOBOTIX: faststream mit den passenden Parametern
            self.host, self.port, self.scheme = host, int(port), scheme
            self.path = build_path(username, sensor, fps, extra)
        self.timeout = timeout
        self._conn = None
        self._resp = None
        self._buf = bytearray()

    # ---------------------------------------------------------------- HTTP
    def _connect(self):
        if self.scheme == "https":
            ctx = ssl.create_default_context()
            ctx.check_hostname = False          # Kameras haben selbstsignierte Zertifikate
            ctx.verify_mode = ssl.CERT_NONE
            return http.client.HTTPSConnection(self.host, self.port, timeout=self.timeout, context=ctx)
        return http.client.HTTPConnection(self.host, self.port, timeout=self.timeout)

    def _request(self, auth_header: Optional[str]):
        conn = self._connect()
        headers = {"User-Agent": "Kestrel-NVR", "Accept": "*/*", "Connection": "close"}
        if auth_header:
            headers["Authorization"] = auth_header
        conn.request("GET", self.path, headers=headers)
        return conn, conn.getresponse()

    def _digest(self, challenge: str) -> str:
        kv = {m.group(1).lower(): (m.group(2) if m.group(2) is not None else m.group(3))
              for m in re.finditer(r'(\w+)=(?:"([^"]*)"|([^,\s]+))', challenge)}
        md5 = lambda s: hashlib.md5(s.encode()).hexdigest()
        realm, nonce = kv.get("realm", ""), kv.get("nonce", "")
        ha1 = md5("%s:%s:%s" % (self.username, realm, self.password))
        ha2 = md5("GET:%s" % self.path)
        out = 'Digest username="%s", realm="%s", nonce="%s", uri="%s"' % (self.username, realm, nonce, self.path)
        if "auth" in kv.get("qop", ""):
            nc, cnonce = "00000001", os.urandom(8).hex()
            resp = md5("%s:%s:%s:%s:auth:%s" % (ha1, nonce, nc, cnonce, ha2))
            out += ', qop=auth, nc=%s, cnonce="%s"' % (nc, cnonce)
        else:
            resp = md5("%s:%s:%s" % (ha1, nonce, ha2))
        out += ', response="%s"' % resp
        if "opaque" in kv:
            out += ', opaque="%s"' % kv["opaque"]
        return out

    def open(self) -> None:
        basic = None
        if self.username:
            token = base64.b64encode(("%s:%s" % (self.username, self.password)).encode()).decode()
            basic = "Basic " + token
        conn, resp = self._request(basic)
        if resp.status == 401:
            chal = resp.getheader("WWW-Authenticate", "") or ""
            resp.read()
            conn.close()
            if "digest" in chal.lower() and self.username:
                conn, resp = self._request(self._digest(chal))
            if resp.status == 401:
                conn.close()
                raise AuthError("Anmeldung abgelehnt (Benutzer/Passwort pruefen)")
        if resp.status != 200:
            conn.close()
            raise StreamError("HTTP %s %s" % (resp.status, resp.reason))
        ctype = resp.getheader("Content-Type", "") or ""
        if "multipart" not in ctype.lower():
            conn.close()
            raise StreamError("Kein M-JPEG-Strom (Content-Type: %s)" % (ctype or "unbekannt"))
        m = re.search(r'boundary="?([^";]+)"?', ctype, re.I)
        self._boundary = (m.group(1).strip().lstrip("-") if m else "MOBOTIX_Fast_Serverpush").encode()
        self._conn, self._resp = conn, resp
        self._buf = bytearray()

    def close(self) -> None:
        try:
            if self._conn:
                self._conn.close()
        except Exception:
            pass
        self._conn = self._resp = None

    # ------------------------------------------------------------- Parser
    def _fill(self) -> None:
        chunk = self._resp.read1(262144)
        if not chunk:
            raise StreamError("Verbindung von der Kamera beendet")
        self._buf += chunk

    def _readline(self) -> bytes:
        while True:
            i = self._buf.find(b"\n")
            if i >= 0:
                line = bytes(self._buf[: i + 1])
                del self._buf[: i + 1]
                return line
            if len(self._buf) > 65536:
                raise StreamError("Kein gueltiger M-JPEG-Strom")
            self._fill()

    def _readexact(self, n: int) -> bytes:
        while len(self._buf) < n:
            self._fill()
        data = bytes(self._buf[:n])
        del self._buf[:n]
        return data

    def _read_until(self, marker: bytes, limit: int = 32 << 20) -> bytes:
        start = 0
        while True:
            i = self._buf.find(marker, start)
            if i >= 0:
                data = bytes(self._buf[:i])
                del self._buf[:i]
                return data
            start = max(0, len(self._buf) - len(marker))
            if len(self._buf) > limit:
                raise StreamError("Bild zu gross / Boundary nicht gefunden")
            self._fill()

    def frames(self) -> Iterator[bytes]:
        """Liefert endlos JPEG-Bilder, exakt wie von der Kamera gesendet."""
        if self._resp is None:
            self.open()
        delim = b"--" + self._boundary
        while True:
            # bis zur naechsten Boundary-Zeile vorlaufen
            skipped = 0
            while True:
                line = self._readline()
                if line.startswith(delim):
                    break
                skipped += len(line)
                if skipped > (8 << 20):
                    raise StreamError("Boundary nicht gefunden")
            length = None
            while True:
                line = self._readline().strip()
                if not line:
                    break
                k, _, v = line.partition(b":")
                if k.strip().lower() == b"content-length":
                    try:
                        length = int(v.strip())
                    except ValueError:
                        length = None
            if length:
                data = self._readexact(length)
            else:
                data = self._read_until(b"\r\n" + delim)
                end = data.rfind(b"\xff\xd9")
                if end >= 0:
                    data = data[: end + 2]
            if data[:2] == b"\xff\xd8":
                yield data
