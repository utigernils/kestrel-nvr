"""SQLite fuer Erkennungen (Boxen) und Ereignisse."""
from __future__ import annotations

import os
import sqlite3
import threading
from typing import List, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS detections(
  camera TEXT NOT NULL, ts INTEGER NOT NULL, label TEXT NOT NULL, score REAL NOT NULL,
  x1 REAL, y1 REAL, x2 REAL, y2 REAL, track INTEGER);
CREATE INDEX IF NOT EXISTS det_cam_ts ON detections(camera, ts);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, camera TEXT NOT NULL, label TEXT NOT NULL,
  start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL, score REAL NOT NULL,
  best_ts INTEGER, x1 REAL, y1 REAL, x2 REAL, y2 REAL, thumb BLOB, active INTEGER DEFAULT 1);
CREATE INDEX IF NOT EXISTS ev_cam_ts ON events(camera, start_ts);
CREATE INDEX IF NOT EXISTS ev_ts ON events(start_ts);
CREATE TABLE IF NOT EXISTS event_frames(
  event_id INTEGER NOT NULL, n INTEGER NOT NULL, ts INTEGER NOT NULL, jpg BLOB NOT NULL,
  PRIMARY KEY(event_id, n));
"""

EV_COLS = "id, camera, label, start_ts, end_ts, score, best_ts, x1, y1, x2, y2, active, previews"


class DB:
    def __init__(self, path: str):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.con = sqlite3.connect(path, check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock:
            self.con.execute("PRAGMA journal_mode=WAL")
            self.con.execute("PRAGMA synchronous=NORMAL")
            self.con.executescript(SCHEMA)
            cols = [r[1] for r in self.con.execute("PRAGMA table_info(events)")]
            if "previews" not in cols:                       # Migration von 1.0/1.1
                self.con.execute("ALTER TABLE events ADD COLUMN previews INTEGER NOT NULL DEFAULT 0")
            if "snapshot" not in cols:                       # Migration von 1.3
                self.con.execute("ALTER TABLE events ADD COLUMN snapshot BLOB")
            self.con.execute("UPDATE events SET active=0 WHERE active=1")
            self.con.commit()

    def add_detections(self, rows: list) -> None:
        if not rows:
            return
        with self.lock:
            self.con.executemany("INSERT INTO detections VALUES(?,?,?,?,?,?,?,?,?)", rows)
            self.con.commit()

    def detections(self, cam: str, start: int, end: int) -> List[list]:
        with self.lock:
            cur = self.con.execute(
                "SELECT ts,label,score,x1,y1,x2,y2,track FROM detections "
                "WHERE camera=? AND ts>=? AND ts<? ORDER BY ts", (cam, start, end))
            return [list(r) for r in cur.fetchall()]

    def create_event(self, cam, label, start_ts, end_ts, score, best_ts, box, thumb, snapshot=None) -> int:
        with self.lock:
            cur = self.con.execute(
                "INSERT INTO events(camera,label,start_ts,end_ts,score,best_ts,x1,y1,x2,y2,thumb,snapshot,active) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)",
                (cam, label, start_ts, end_ts, score, best_ts, *box, thumb, snapshot))
            self.con.commit()
            return cur.lastrowid

    def update_event(self, eid, end_ts, score=None, best_ts=None, box=None, thumb=None, active=1, snapshot=None) -> None:
        with self.lock:
            if thumb is not None:
                self.con.execute(
                    "UPDATE events SET end_ts=?,score=?,best_ts=?,x1=?,y1=?,x2=?,y2=?,thumb=?,snapshot=?,active=? WHERE id=?",
                    (end_ts, score, best_ts, *box, thumb, snapshot, active, eid))
            else:
                self.con.execute("UPDATE events SET end_ts=?,active=? WHERE id=?", (end_ts, active, eid))
            self.con.commit()

    def events(self, camera=None, label=None, start=None, end=None, limit=100, after=None, asc=False) -> List[dict]:
        q, a = "SELECT %s FROM events WHERE 1=1" % EV_COLS, []
        if camera:
            q += " AND camera=?"; a.append(camera)
        if label:
            q += " AND label=?"; a.append(label)
        if start is not None:
            q += " AND end_ts>=?"; a.append(start)
        if end is not None:
            q += " AND start_ts<?"; a.append(end)
        if after is not None:
            q += " AND start_ts>=?"; a.append(after)
        q += " ORDER BY start_ts %s LIMIT ?" % ("ASC" if asc else "DESC")
        a.append(max(1, min(int(limit), 2000)))
        with self.lock:
            return [dict(r) for r in self.con.execute(q, a).fetchall()]

    def event_windows(self, cam: str, start: int, end: int) -> list:
        with self.lock:
            return [(r[0], r[1]) for r in self.con.execute(
                "SELECT start_ts, end_ts FROM events WHERE camera=? AND end_ts>=? AND start_ts<=?",
                (cam, start, end))]

    def active_events(self) -> List[dict]:
        with self.lock:
            return [dict(r) for r in self.con.execute("SELECT %s FROM events WHERE active=1" % EV_COLS)]

    def last_event(self, cam: str) -> Optional[dict]:
        with self.lock:
            r = self.con.execute("SELECT %s FROM events WHERE camera=? ORDER BY start_ts DESC LIMIT 1" % EV_COLS,
                                 (cam,)).fetchone()
        return dict(r) if r else None

    def add_event_frame(self, eid: int, n: int, ts: int, jpg: bytes) -> None:
        with self.lock:
            self.con.execute("INSERT OR REPLACE INTO event_frames VALUES(?,?,?,?)", (eid, n, ts, jpg))
            self.con.execute("UPDATE events SET previews=? WHERE id=?", (n + 1, eid))
            self.con.commit()

    def event_frames(self, eid: int) -> List[int]:
        with self.lock:
            return [r[0] for r in self.con.execute("SELECT ts FROM event_frames WHERE event_id=? ORDER BY n", (eid,))]

    def event_frame(self, eid: int, n: int) -> Optional[bytes]:
        with self.lock:
            r = self.con.execute("SELECT jpg FROM event_frames WHERE event_id=? AND n=?", (eid, n)).fetchone()
        return bytes(r[0]) if r else None

    def event(self, eid: int) -> Optional[dict]:
        with self.lock:
            r = self.con.execute("SELECT %s FROM events WHERE id=?" % EV_COLS, (eid,)).fetchone()
        return dict(r) if r else None

    def snapshot(self, eid: int) -> Optional[bytes]:
        """Ganzes Bild zum besten Zeitpunkt; bei aelteren Ereignissen der Ausschnitt."""
        with self.lock:
            r = self.con.execute("SELECT snapshot, thumb FROM events WHERE id=?", (eid,)).fetchone()
        if not r:
            return None
        blob = r[0] if r[0] is not None else r[1]
        return bytes(blob) if blob is not None else None

    def thumb(self, eid: int) -> Optional[bytes]:
        with self.lock:
            r = self.con.execute("SELECT thumb FROM events WHERE id=?", (eid,)).fetchone()
        return bytes(r[0]) if r and r[0] is not None else None

    def delete_event(self, eid: int) -> None:
        with self.lock:
            self.con.execute("DELETE FROM events WHERE id=?", (eid,))
            self.con.execute("DELETE FROM event_frames WHERE event_id=?", (eid,))
            self.con.commit()

    def labels(self) -> List[str]:
        with self.lock:
            return [r[0] for r in self.con.execute("SELECT DISTINCT label FROM events ORDER BY label")]

    def prune(self, before_ts: int) -> None:
        with self.lock:
            self.con.execute("DELETE FROM detections WHERE ts<?", (before_ts,))
            self.con.execute("DELETE FROM event_frames WHERE event_id IN "
                             "(SELECT id FROM events WHERE end_ts<? AND active=0)", (before_ts,))
            self.con.execute("DELETE FROM events WHERE end_ts<? AND active=0", (before_ts,))
            self.con.commit()
