"""Zustand von Kestrel: Abfrage alle paar Sekunden plus sofortige Meldungen per Push (SSE)."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import datetime, timezone

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import KestrelAuthError, KestrelClient, KestrelError
from .const import DOMAIN, EVENT_KESTREL, SCAN_INTERVAL

_LOGGER = logging.getLogger(__name__)

EventListener = Callable[[str, dict], None]


def _iso(ts_ms: int | None) -> str | None:
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat() if ts_ms else None


class KestrelCoordinator(DataUpdateCoordinator[dict]):
    config_entry: ConfigEntry

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, client: KestrelClient) -> None:
        super().__init__(hass, _LOGGER, name=DOMAIN, config_entry=entry, update_interval=SCAN_INTERVAL)
        self.client = client
        self.push_connected = False
        self._event_listeners: list[EventListener] = []
        # laufende Ereignisse, wie sie der Push gemeldet hat: Kamera -> {Ereignis-ID: Label}
        self._running: dict[str, dict[int, str]] = {}

    async def _async_update_data(self) -> dict:
        try:
            data = await self.client.state()
        except KestrelAuthError as err:
            raise ConfigEntryAuthFailed("Zugriff wurde in Kestrel entzogen") from err
        except KestrelError as err:
            raise UpdateFailed(str(err)) from err
        data["by_name"] = {c["name"]: c for c in data.get("cameras", [])}
        return data

    def camera(self, name: str) -> dict | None:
        return (self.data or {}).get("by_name", {}).get(name)

    # ------------------------------------------------------------------ Push
    @callback
    def async_add_event_listener(self, listener: EventListener) -> CALLBACK_TYPE:
        """Meldet jedes Ereignis (Art, Daten) sofort an Entitaeten weiter."""
        self._event_listeners.append(listener)
        return lambda: self._event_listeners.remove(listener)

    @callback
    def async_start_push(self) -> None:
        self.config_entry.async_create_background_task(self.hass, self._push_loop(), name="kestrel_event_stream")

    async def _push_loop(self) -> None:
        """Haelt die Ereignis-Verbindung offen; bei Abbruch neu verbinden (2 s ... 60 s)."""
        delay = 2
        while True:
            try:
                async for msg in self.client.events_stream():
                    if not self.push_connected:
                        self.push_connected = True
                        delay = 2
                    self._handle_push(msg.get("type", "update"), msg["event"])
            except KestrelAuthError:
                self.push_connected = False
                _LOGGER.warning("Kestrel hat den Zugriff entzogen - bitte erneut verbinden")
                self.config_entry.async_start_reauth(self.hass)
                return
            except KestrelError as err:
                _LOGGER.debug("Ereignis-Verbindung zu Kestrel unterbrochen: %s", err)
            self.push_connected = False
            await asyncio.sleep(delay)
            delay = min(delay * 2, 60)
            # Was waehrend der Unterbrechung passiert ist, holt die normale Abfrage nach.
            await self.async_request_refresh()

    @callback
    def _handle_push(self, kind: str, event: dict) -> None:
        name = event.get("camera")
        cam = self.camera(name)
        if cam is not None:
            running = self._running.setdefault(name, {})
            if kind == "end":
                running.pop(event["id"], None)
                labels = set(cam.get("active_labels") or [])
                if event["label"] not in running.values():
                    labels.discard(event["label"])
            else:
                running[event["id"]] = event["label"]
                labels = set(cam.get("active_labels") or []) | {event["label"]}
            cam["active_labels"] = sorted(labels)
            cam["last_event"] = {k: event.get(k) for k in ("id", "label", "start_ts", "end_ts", "score", "active")}

        # Erst die Entitaeten (Bild, Ereignis, Binaersensoren), dann das Bus-Ereignis: eine
        # Automation, die darauf reagiert, findet das neue Bild schon vor.
        for listener in list(self._event_listeners):
            listener(kind, event)
        if self.data is not None:
            self.async_set_updated_data(self.data)
        self.hass.bus.async_fire(EVENT_KESTREL, self.event_payload(kind, event))
        if kind == "end":
            self.hass.async_create_task(self.async_request_refresh())

    def event_payload(self, kind: str, event: dict) -> dict:
        """Daten des Bus-Ereignisses `kestrel_event` (aehnlich wie bei Frigate)."""
        from .entity import instance_id
        registry = er.async_get(self.hass)
        iid = instance_id(self)
        camera = event.get("camera")
        return {
            "type": kind,
            "event_id": event.get("id"),
            "camera": camera,
            "label": event.get("label"),
            "score": event.get("score"),
            "active": bool(event.get("active")),
            "start_time": _iso(event.get("start_ts")),
            "end_time": None if kind != "end" else _iso(event.get("end_ts")),
            "camera_entity": registry.async_get_entity_id("camera", DOMAIN, f"{iid}_{camera}_camera"),
            "image_entity": registry.async_get_entity_id("image", DOMAIN, f"{iid}_{camera}_last_event_image"),
            "entry_id": self.config_entry.entry_id,
        }
