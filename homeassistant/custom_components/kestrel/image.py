"""Bild des letzten Ereignisses je Kamera - z. B. fuer Benachrichtigungen mit Foto."""
from __future__ import annotations

from datetime import datetime, timezone

from homeassistant.components.image import ImageEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .api import KestrelError
from .entity import KestrelCameraEntity, track_cameras


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator = entry.runtime_data
    track_cameras(coordinator, entry, async_add_entities, lambda name: [KestrelLastEventImage(hass, coordinator, name)])


class KestrelLastEventImage(KestrelCameraEntity, ImageEntity):
    _attr_translation_key = "last_event"
    _attr_content_type = "image/jpeg"

    def __init__(self, hass: HomeAssistant, coordinator, camera: str) -> None:
        KestrelCameraEntity.__init__(self, coordinator, camera, "last_event_image")
        ImageEntity.__init__(self, hass)
        self._event: dict | None = None
        self._bytes: bytes | None = None
        self._bytes_key: tuple | None = None
        last = self.cam.get("last_event")
        if last:
            self._event = {**last, "camera": camera}
            self._attr_image_last_updated = datetime.fromtimestamp(last["start_ts"] / 1000, tz=timezone.utc)

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(self.coordinator.async_add_event_listener(self._on_event))

    @callback
    def _on_event(self, kind: str, event: dict) -> None:
        if event.get("camera") != self.camera_name:
            return
        self._event = event
        # Neues Ereignis oder besseres Bild: Zeitstempel aendern -> Home Assistant laedt neu.
        self._attr_image_last_updated = dt_util.utcnow()
        self.async_write_ha_state()

    @property
    def extra_state_attributes(self) -> dict:
        e = self._event or {}
        return {"event_id": e.get("id"), "label": e.get("label"), "score": e.get("score")}

    async def async_image(self) -> bytes | None:
        if not self._event:
            return None
        key = (self._event["id"], self._attr_image_last_updated)
        if key != self._bytes_key:
            try:
                self._bytes = await self.coordinator.client.snapshot(self._event["id"])
                self._bytes_key = key
            except KestrelError:
                return self._bytes
        return self._bytes
