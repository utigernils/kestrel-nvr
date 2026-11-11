"""Sensoren: Bildrate, letztes Ereignis, Speicher, CPU, Version."""
from __future__ import annotations

from datetime import datetime, timezone

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.const import PERCENTAGE, EntityCategory, UnitOfInformation, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .entity import KestrelCameraEntity, KestrelHubEntity, track_cameras


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator = entry.runtime_data
    async_add_entities([
        KestrelSystemSensor(coordinator, "storage_used", "storage_used", SensorDeviceClass.DATA_SIZE, UnitOfInformation.BYTES, UnitOfInformation.GIGABYTES),
        KestrelSystemSensor(coordinator, "disk_free", "disk_free", SensorDeviceClass.DATA_SIZE, UnitOfInformation.BYTES, UnitOfInformation.GIGABYTES),
        KestrelSystemSensor(coordinator, "capacity_days", "capacity_days", SensorDeviceClass.DURATION, UnitOfTime.DAYS, None),
        KestrelSystemSensor(coordinator, "cpu_percent", "cpu_percent", None, PERCENTAGE, None),
        KestrelVersion(coordinator),
    ])
    track_cameras(coordinator, entry, async_add_entities, lambda name: [
        KestrelFps(coordinator, name), KestrelLastEvent(coordinator, name), KestrelLastEventTime(coordinator, name)])


class KestrelSystemSensor(KestrelHubEntity, SensorEntity):
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator, key, field, device_class, unit, suggested) -> None:
        super().__init__(coordinator, key)
        self._field = field
        self._attr_translation_key = key
        self._attr_device_class = device_class
        self._attr_native_unit_of_measurement = unit
        if suggested:
            self._attr_suggested_unit_of_measurement = suggested
            self._attr_suggested_display_precision = 1

    @property
    def native_value(self):
        v = self.system.get(self._field)
        return round(v, 2) if isinstance(v, float) else v


class KestrelVersion(KestrelHubEntity, SensorEntity):
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_translation_key = "version"

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator, "version")

    @property
    def native_value(self):
        return (self.coordinator.data or {}).get("version")


class KestrelFps(KestrelCameraEntity, SensorEntity):
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_native_unit_of_measurement = "fps"
    _attr_translation_key = "fps"
    _attr_suggested_display_precision = 1

    def __init__(self, coordinator, camera: str) -> None:
        super().__init__(coordinator, camera, "fps")

    @property
    def native_value(self):
        return self.cam.get("fps")


class KestrelLastEvent(KestrelCameraEntity, SensorEntity):
    _attr_translation_key = "last_event"

    def __init__(self, coordinator, camera: str) -> None:
        super().__init__(coordinator, camera, "last_event")

    @property
    def native_value(self):
        ev = self.cam.get("last_event")
        return ev["label"] if ev else None

    @property
    def extra_state_attributes(self) -> dict:
        ev = self.cam.get("last_event") or {}
        return {"event_id": ev.get("id"), "score": ev.get("score"), "active": bool(ev.get("active"))}


class KestrelLastEventTime(KestrelCameraEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_translation_key = "last_event_time"

    def __init__(self, coordinator, camera: str) -> None:
        super().__init__(coordinator, camera, "last_event_time")

    @property
    def native_value(self):
        ev = self.cam.get("last_event")
        return datetime.fromtimestamp(ev["start_ts"] / 1000, tz=timezone.utc) if ev else None
