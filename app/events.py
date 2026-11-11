"""Ereignis-Verteiler: meldet Start, Aenderung und Ende von Ereignissen an Abonnenten.

Die Erkennung laeuft in einem eigenen Thread, die Abonnenten (Home Assistant ueber
/api/ha/events/stream) haengen am asyncio-Loop. publish() ist deshalb thread-sicher.
"""
from __future__ import annotations

import asyncio
from typing import Optional, Set


class EventBus:
    def __init__(self) -> None:
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.subs: Set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self.subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.subs.discard(q)

    def _deliver(self, msg: dict) -> None:
        for q in list(self.subs):
            if q.full():                    # haengender Abonnent: aelteste Meldung verwerfen
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(msg)

    def publish(self, kind: str, event: dict) -> None:
        """kind: start | update | end"""
        if self.loop and self.subs:
            self.loop.call_soon_threadsafe(self._deliver, {"type": kind, "event": event})
