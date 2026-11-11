"""Binaersensoren: Kamera online, Person/Fahrzeug/Tier/Objekt erkannt, Speicherproblem."""
from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import ANIMAL_LABELS, VEHICLE_LABELS
from .entity import KestrelCameraEntity, KestrelHubEntity, track_cameras

# Schluessel -> (Geraeteklasse, Menge der Labels oder None fuer "irgendein Objekt")
DETECTION = {
    "person": (BinarySensorDeviceClass.OCCUPANCY, {"person"}),
    "vehicle": (BinarySensorDeviceClass.OCCUPANCY, VEHICLE_LABELS),
    "animal": (BinarySensorDeviceClass.OCCUPANCY, ANIMAL_LABELS),
    "object": (BinarySensorDeviceClass.MOTION, None),
}


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator = entry.runtime_data
    async_add_entities([KestrelStorageProblem(coordinator)])
    track_cameras(coordinator, entry, async_add_entities, lambda name: [
        KestrelOnline(coordinator, name), *(KestrelDetection(coordinator, name, key) for key in DETECTION)])


class KestrelOnline(KestrelCameraEntity, BinarySensorEntity):
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_translation_key = "online"

    def __init__(self, coordinator, camera: str) -> None:
        super().__init__(coordinator, camera, "online")

    @property
    def is_on(self) -> bool:
        return bool(self.cam.get("online"))


class KestrelDetection(KestrelCameraEntity, BinarySensorEntity):
    def __init__(self, coordinator, camera: str, key: str) -> None:
        super().__init__(coordinator, camera, key)
        self._attr_device_class, self._labels = DETECTION[key]
        self._attr_translation_key = key

    @property
    def _active(self) -> list[str]:
        labels = self.cam.get("active_labels") or []
        return labels if self._labels is None else [l for l in labels if l in self._labels]

    @property
    def is_on(self) -> bool:
        return bool(self._active)

    @property
    def extra_state_attributes(self) -> dict:
        return {"labels": self._active}


class KestrelStorageProblem(KestrelHubEntity, BinarySensorEntity):
    _attr_device_class = BinarySensorDeviceClass.PROBLEM
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_translation_key = "storage_problem"

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator, "storage_problem")

    @property
    def is_on(self) -> bool:
        return bool(self.system.get("recording_paused") or self.system.get("storage_warning"))

    @property
    def extra_state_attributes(self) -> dict:
        return {"message": self.system.get("storage_warning") or "",
                "recording_paused": bool(self.system.get("recording_paused"))}
