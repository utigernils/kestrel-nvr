"""Ereignis-Entitaet je Kamera: meldet Beginn und Ende einer Erkennung."""
from __future__ import annotations

from homeassistant.components.event import EventEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .entity import KestrelCameraEntity, track_cameras

TYPES = {"start": "detected", "end": "ended"}


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator = entry.runtime_data
    track_cameras(coordinator, entry, async_add_entities, lambda name: [KestrelDetectionEvent(coordinator, name)])


class KestrelDetectionEvent(KestrelCameraEntity, EventEntity):
    _attr_translation_key = "detection"
    _attr_event_types = list(TYPES.values())

    def __init__(self, coordinator, camera: str) -> None:
        super().__init__(coordinator, camera, "detection_event")

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(self.coordinator.async_add_event_listener(self._on_event))

    @callback
    def _on_event(self, kind: str, event: dict) -> None:
        if event.get("camera") != self.camera_name or kind not in TYPES:
            return
        self._trigger_event(TYPES[kind], {"label": event.get("label"), "score": event.get("score"), "event_id": event.get("id")})
        self.async_write_ha_state()

    @callback
    def _handle_coordinator_update(self) -> None:
        """Abfragen aendern den Zustand einer Ereignis-Entitaet nicht."""
