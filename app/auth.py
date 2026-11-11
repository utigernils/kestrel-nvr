"""Benutzer, Sitzungen und Home-Assistant-Kopplung.

Sicherheitsmodell:
  * Passwoerter: scrypt mit zufaelligem Salt, nur der Hash liegt in der Datenbank.
  * Sitzungen:   zufaelliges 256-Bit-Token im HttpOnly-Cookie, in der DB nur dessen SHA-256.
  * Home Assistant: fragt eine Kopplung an und bekommt erst nach Freigabe durch einen Admin
    ein eigenes Token (nur Lesezugriff auf /api/ha/*). Auch davon liegt nur der Hash in der DB.
  * Anmeldeversuche und Kopplungsanfragen sind pro Absender-IP begrenzt.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import threading
import time
import uuid
from typing import Dict, List, Optional

SESSION_DAYS = 30
COOKIE = "kestrel_session"
ROLES = ("admin", "viewer")
PAIR_TTL = 600          # Sekunden, die eine Kopplungsanfrage gueltig ist

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created INTEGER NOT NULL,
  expires INTEGER NOT NULL, ip TEXT, agent TEXT);
CREATE TABLE IF NOT EXISTS ha_clients(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL, last_seen INTEGER, ip TEXT, approved_by TEXT);
"""


class AuthError(ValueError):
    """Eingabefehler mit Code, damit die Oberflaeche ihn uebersetzen kann."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _sha(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    n, r, p = 1 << 14, 8, 1
    h = hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, dklen=32)
    return "scrypt$%d$%d$%d$%s$%s" % (n, r, p, salt.hex(), h.hex())


def verify_password(password: str, stored: str) -> bool:
    try:
        kind, n, r, p, salt, h = stored.split("$")
        if kind != "scrypt":
            return False
        calc = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(calc.hex(), h)
    except Exception:
        return False


def check_username(name: str) -> str:
    name = (name or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{2,32}", name):
        raise AuthError("username_invalid", "Benutzername: 2-32 Zeichen, nur Buchstaben, Ziffern, . _ -")
    return name


def check_password(pw: str) -> str:
    if len(pw or "") < 8:
        raise AuthError("password_short", "Das Passwort braucht mindestens 8 Zeichen")
    if len(pw) > 200:
        raise AuthError("password_long", "Passwort zu lang")
    return pw


class Limiter:
    """Bremst wiederholte Fehlversuche pro Schluessel (IP)."""

    def __init__(self, free: int = 5, base: float = 30, cap: float = 900):
        self.free, self.base, self.cap = free, base, cap
        self.d: Dict[str, list] = {}
        self.lock = threading.Lock()

    def blocked(self, key: str) -> float:
        with self.lock:
            e = self.d.get(key)
            return max(0.0, e[1] - time.time()) if e else 0.0

    def fail(self, key: str) -> None:
        with self.lock:
            now = time.time()
            e = self.d.setdefault(key, [0, 0.0, now])
            if now - e[2] > 3600:
                e[0] = 0
            e[0] += 1
            e[2] = now
            if e[0] >= self.free:
                e[1] = now + min(self.cap, self.base * 2 ** (e[0] - self.free))
            if len(self.d) > 5000:
                for k in [k for k, v in self.d.items() if now - v[2] > 3600]:
                    self.d.pop(k, None)

    def ok(self, key: str) -> None:
        with self.lock:
            self.d.pop(key, None)


class Auth:
    def __init__(self, db):
        self.db = db
        with db.lock:
            db.con.executescript(SCHEMA)
            db.con.commit()
        self.login_limit = Limiter()
        self.pair_limit = Limiter(free=6, base=60)
        self._scache: Dict[str, tuple] = {}
        self._hcache: Dict[str, tuple] = {}
        self.pending: Dict[str, dict] = {}
        self.plock = threading.Lock()
        self.instance_id = self._meta("instance_id") or self._set_meta("instance_id", uuid.uuid4().hex)

    # --------------------------------------------------------------- meta
    def _meta(self, key: str) -> Optional[str]:
        with self.db.lock:
            r = self.db.con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return r[0] if r else None

    def _set_meta(self, key: str, value: str) -> str:
        with self.db.lock:
            self.db.con.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", (key, value))
            self.db.con.commit()
        return value

    # ----------------------------------------------------------- Benutzer
    def user_count(self) -> int:
        with self.db.lock:
            return self.db.con.execute("SELECT COUNT(*) FROM users").fetchone()[0]

    def users(self) -> List[dict]:
        with self.db.lock:
            return [dict(r) for r in self.db.con.execute(
                "SELECT id, username, role, created FROM users ORDER BY username")]

    def _admins(self) -> int:
        with self.db.lock:
            return self.db.con.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0]

    def create_user(self, username: str, password: str, role: str = "viewer") -> int:
        username, password = check_username(username), check_password(password)
        if role not in ROLES:
            raise AuthError("role_unknown", "Unbekannte Rolle")
        with self.db.lock:
            if self.db.con.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
                raise AuthError("user_exists", "Diesen Benutzer gibt es schon")
            cur = self.db.con.execute("INSERT INTO users(username,pw_hash,role,created) VALUES(?,?,?,?)",
                                      (username, hash_password(password), role, int(time.time())))
            self.db.con.commit()
            return cur.lastrowid

    def update_user(self, uid: int, role: Optional[str] = None, password: Optional[str] = None) -> None:
        with self.db.lock:
            u = self.db.con.execute("SELECT role FROM users WHERE id=?", (uid,)).fetchone()
        if not u:
            raise AuthError("user_not_found", "Benutzer nicht gefunden")
        if role is not None and role != u["role"]:
            if role not in ROLES:
                raise AuthError("role_unknown", "Unbekannte Rolle")
            if u["role"] == "admin" and self._admins() <= 1:
                raise AuthError("last_admin", "Der letzte Administrator kann nicht herabgestuft werden")
            with self.db.lock:
                self.db.con.execute("UPDATE users SET role=? WHERE id=?", (role, uid))
                self.db.con.commit()
        if password:
            check_password(password)
            with self.db.lock:
                self.db.con.execute("UPDATE users SET pw_hash=? WHERE id=?", (hash_password(password), uid))
                self.db.con.commit()
            self.drop_sessions(uid)            # Passwortwechsel meldet alle Geraete ab
        self._scache.clear()

    def delete_user(self, uid: int) -> None:
        with self.db.lock:
            u = self.db.con.execute("SELECT role FROM users WHERE id=?", (uid,)).fetchone()
        if not u:
            raise AuthError("user_not_found", "Benutzer nicht gefunden")
        if u["role"] == "admin" and self._admins() <= 1:
            raise AuthError("last_admin", "Der letzte Administrator kann nicht geloescht werden")
        with self.db.lock:
            self.db.con.execute("DELETE FROM users WHERE id=?", (uid,))
            self.db.con.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
            self.db.con.commit()
        self._scache.clear()

    def check_login(self, username: str, password: str) -> Optional[dict]:
        with self.db.lock:
            r = self.db.con.execute("SELECT id, username, role, pw_hash FROM users WHERE username=?",
                                    ((username or "").strip(),)).fetchone()
        if not r:
            hash_password(password or "")        # gleiche Rechenzeit, verraet nicht ob es den Namen gibt
            return None
        if not verify_password(password or "", r["pw_hash"]):
            return None
        return {"id": r["id"], "username": r["username"], "role": r["role"]}

    def verify_user_password(self, uid: int, password: str) -> bool:
        with self.db.lock:
            r = self.db.con.execute("SELECT pw_hash FROM users WHERE id=?", (uid,)).fetchone()
        return bool(r) and verify_password(password or "", r["pw_hash"])

    # ---------------------------------------------------------- Sitzungen
    def create_session(self, uid: int, ip: str, agent: str) -> str:
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        with self.db.lock:
            self.db.con.execute("DELETE FROM sessions WHERE expires<?", (now,))
            self.db.con.execute("INSERT INTO sessions VALUES(?,?,?,?,?,?)",
                                (_sha(token), uid, now, now + SESSION_DAYS * 86400, ip, (agent or "")[:200]))
            self.db.con.commit()
        return token

    def session_user(self, token: Optional[str]) -> Optional[dict]:
        if not token or len(token) > 200:
            return None
        th, now = _sha(token), time.time()
        c = self._scache.get(th)
        if c and c[0] > now:
            return c[1]
        with self.db.lock:
            r = self.db.con.execute(
                "SELECT u.id, u.username, u.role, s.expires FROM sessions s JOIN users u ON u.id=s.user_id "
                "WHERE s.token_hash=?", (th,)).fetchone()
            if r and r["expires"] < now:
                self.db.con.execute("DELETE FROM sessions WHERE token_hash=?", (th,))
                self.db.con.commit()
                r = None
            elif r and r["expires"] - now < (SESSION_DAYS - 1) * 86400:      # gleitende Verlaengerung
                self.db.con.execute("UPDATE sessions SET expires=? WHERE token_hash=?",
                                    (int(now) + SESSION_DAYS * 86400, th))
                self.db.con.commit()
        user = {"id": r["id"], "username": r["username"], "role": r["role"]} if r else None
        if len(self._scache) > 2000:
            self._scache.clear()
        self._scache[th] = (now + 20, user)
        return user

    def drop_session(self, token: Optional[str]) -> None:
        if not token:
            return
        with self.db.lock:
            self.db.con.execute("DELETE FROM sessions WHERE token_hash=?", (_sha(token),))
            self.db.con.commit()
        self._scache.clear()

    def drop_sessions(self, uid: int) -> None:
        with self.db.lock:
            self.db.con.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
            self.db.con.commit()
        self._scache.clear()

    # ----------------------------------------------- Home Assistant: Token
    def ha_client(self, token: Optional[str], ip: str = "") -> Optional[dict]:
        if not token or len(token) > 200:
            return None
        th, now = _sha(token), time.time()
        c = self._hcache.get(th)
        if c and c[0] > now:
            return c[1]
        with self.db.lock:
            r = self.db.con.execute("SELECT id, name FROM ha_clients WHERE token_hash=?", (th,)).fetchone()
            if r:
                self.db.con.execute("UPDATE ha_clients SET last_seen=?, ip=? WHERE id=?", (int(now), ip, r["id"]))
                self.db.con.commit()
        client = {"id": r["id"], "name": r["name"]} if r else None
        if len(self._hcache) > 500:
            self._hcache.clear()
        self._hcache[th] = (now + 30, client)
        return client

    def ha_clients(self) -> List[dict]:
        with self.db.lock:
            return [dict(r) for r in self.db.con.execute(
                "SELECT id, name, created, last_seen, ip, approved_by FROM ha_clients ORDER BY created")]

    def ha_revoke(self, cid: int) -> None:
        with self.db.lock:
            self.db.con.execute("DELETE FROM ha_clients WHERE id=?", (cid,))
            self.db.con.commit()
        self._hcache.clear()

    # ------------------------------------------- Home Assistant: Kopplung
    def _prune_pending(self) -> None:
        now = time.time()
        for k in [k for k, v in self.pending.items() if now - v["created"] > PAIR_TTL]:
            self.pending.pop(k, None)

    def pair_request(self, name: str, ip: str) -> dict:
        name = re.sub(r"[^\w .:()\-]", "", (name or "Home Assistant"))[:60].strip() or "Home Assistant"
        with self.plock:
            self._prune_pending()
            open_reqs = [v for v in self.pending.values() if v["status"] == "pending"]
            if len(open_reqs) >= 5 or sum(1 for v in open_reqs if v["ip"] == ip) >= 2:
                raise PermissionError("Zu viele offene Kopplungsanfragen")
            rid, secret = secrets.token_urlsafe(12), secrets.token_urlsafe(32)
            code = "%06d" % secrets.randbelow(1_000_000)
            self.pending[rid] = {"id": rid, "secret_hash": _sha(secret), "code": code, "name": name,
                                 "ip": ip, "created": time.time(), "status": "pending", "token": None}
        return {"id": rid, "secret": secret, "code": code, "expires_in": PAIR_TTL}

    def pair_pending(self) -> List[dict]:
        with self.plock:
            self._prune_pending()
            return [{"id": v["id"], "name": v["name"], "ip": v["ip"], "code": v["code"],
                     "created": int(v["created"] * 1000), "expires_in": int(PAIR_TTL - (time.time() - v["created"]))}
                    for v in self.pending.values() if v["status"] == "pending"]

    def pair_decide(self, rid: str, allow: bool, admin: str) -> None:
        with self.plock:
            self._prune_pending()
            v = self.pending.get(rid)
            if not v or v["status"] != "pending":
                raise AuthError("pair_gone", "Anfrage nicht mehr vorhanden")
            if not allow:
                v["status"] = "denied"
                return
            token = secrets.token_urlsafe(32)
            with self.db.lock:
                self.db.con.execute(
                    "INSERT INTO ha_clients(name, token_hash, created, ip, approved_by) VALUES(?,?,?,?,?)",
                    (v["name"], _sha(token), int(time.time()), v["ip"], admin))
                self.db.con.commit()
            v["status"], v["token"] = "approved", token

    def pair_poll(self, rid: str, secret: str) -> dict:
        with self.plock:
            self._prune_pending()
            v = self.pending.get(rid)
            if not v or not hmac.compare_digest(v["secret_hash"], _sha(secret or "")):
                return {"status": "unknown"}
            if v["status"] == "approved":
                token = v["token"]
                self.pending.pop(rid, None)        # das Token wird genau einmal ausgeliefert
                return {"status": "approved", "token": token}
            if v["status"] == "denied":
                self.pending.pop(rid, None)
                return {"status": "denied"}
            return {"status": "pending"}
