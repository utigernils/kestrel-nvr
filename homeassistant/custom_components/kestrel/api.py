"""Schlanker HTTP-Client fuer die Kestrel-Token-API (/api/ha/*)."""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import aiohttp


class KestrelError(Exception):
    """Allgemeiner Fehler."""


class KestrelConnectionError(KestrelError):
    """Kestrel ist nicht erreichbar."""


class KestrelAuthError(KestrelError):
    """Token ungueltig oder widerrufen."""


class KestrelRateLimited(KestrelError):
    """Zu viele Anfragen."""


class KestrelClient:
    def __init__(self, session: aiohttp.ClientSession, host: str, port: int, ssl: bool = False,
                 token: str | None = None) -> None:
        self._session = session
        self.base = f"{'https' if ssl else 'http'}://{host}:{port}"
        self._token = token

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}"} if self._token else {}

    def url(self, path: str) -> str:
        return self.base + path

    async def _request(self, method: str, path: str, json: dict | None = None, raw: bool = False,
                       auth: bool = True) -> Any:
        try:
            async with self._session.request(
                method, self.url(path), json=json, headers=self.headers if auth else {},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status == 401:
                    raise KestrelAuthError("Token abgelehnt")
                if resp.status == 429:
                    raise KestrelRateLimited("Zu viele Anfragen")
                if resp.status >= 400:
                    raise KestrelError(f"HTTP {resp.status}")
                return await resp.read() if raw else await resp.json()
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise KestrelConnectionError(str(err) or type(err).__name__) from err

    async def pair_request(self, name: str) -> dict:
        return await self._request("POST", "/api/ha/pair/request", {"name": name}, auth=False)

    async def pair_poll(self, pair_id: str, secret: str) -> dict:
        return await self._request("POST", "/api/ha/pair/poll", {"id": pair_id, "secret": secret}, auth=False)

    async def state(self) -> dict:
        return await self._request("GET", "/api/ha/state")

    async def image(self, camera: str) -> bytes:
        return await self._request("GET", f"/api/ha/cameras/{camera}/latest.jpg", raw=True)

    def stream_url(self, camera: str) -> str:
        return self.url(f"/api/ha/cameras/{camera}/live.mjpg")

    async def events(self, camera: str | None = None, limit: int = 20) -> list[dict]:
        query = f"?limit={limit}" + (f"&camera={camera}" if camera else "")
        return await self._request("GET", "/api/ha/events" + query)

    async def snapshot(self, event_id: int) -> bytes:
        """Bestes Bild eines Ereignisses (JPEG)."""
        return await self._request("GET", f"/api/ha/events/{event_id}/snapshot.jpg", raw=True)

    async def thumbnail(self, event_id: int) -> bytes:
        return await self._request("GET", f"/api/ha/events/{event_id}/thumb.jpg", raw=True)

    async def events_stream(self) -> AsyncIterator[dict]:
        """Server-Sent Events von Kestrel: liefert {"type": start|update|end, "event": {...}}.

        Laeuft, bis die Verbindung endet. 401 -> KestrelAuthError, sonst KestrelConnectionError.
        """
        try:
            async with self._session.get(
                self.url("/api/ha/events/stream"), headers={**self.headers, "Accept": "text/event-stream"},
                timeout=aiohttp.ClientTimeout(total=None, connect=10, sock_read=45),
            ) as resp:
                if resp.status == 401:
                    raise KestrelAuthError("Token abgelehnt")
                if resp.status >= 400:
                    raise KestrelError(f"HTTP {resp.status}")
                data: list[str] = []
                async for raw in resp.content:
                    line = raw.decode("utf-8", "replace").rstrip("\r\n")
                    if line.startswith("data:"):
                        data.append(line[5:].lstrip())
                    elif not line and data:
                        try:
                            msg = json.loads("\n".join(data))
                        except ValueError:
                            msg = None
                        data = []
                        if isinstance(msg, dict) and "event" in msg:
                            yield msg
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise KestrelConnectionError(str(err) or type(err).__name__) from err
