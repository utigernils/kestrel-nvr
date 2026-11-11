"""Gemeinsame Basis: Geraete-Zuordnung."""
from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_INSTANCE_ID, DOMAIN
from .coordinator import KestrelCoordinator


def instance_id(coordinator: KestrelCoordinator) -> str:
    entry = coordinator.config_entry
    return entry.unique_id or entry.data.get(CONF_INSTANCE_ID) or entry.entry_id


class KestrelHubEntity(CoordinatorEntity[KestrelCoordinator]):
    """Entitaet des Rekorders selbst."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: KestrelCoordinator, key: str) -> None:
        super().__init__(coordinator)
        iid = instance_id(coordinator)
        self._attr_unique_id = f"{iid}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, iid)}, name="Kestrel NVR", manufacturer="Kestrel", model="NVR",
            sw_version=(coordinator.data or {}).get("version"), configuration_url=coordinator.client.base,
        )

    @property
    def system(self) -> dict:
        return (self.coordinator.data or {}).get("system", {})


class KestrelCameraEntity(CoordinatorEntity[KestrelCoordinator]):
    """Entitaet einer Kamera."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: KestrelCoordinator, camera: str, key: str) -> None:
        super().__init__(coordinator)
        iid = instance_id(coordinator)
        self.camera_name = camera
        self._attr_unique_id = f"{iid}_{camera}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"{iid}_{camera}")}, name=camera, manufacturer="MOBOTIX",
            model="M-JPEG Kamera", via_device=(DOMAIN, iid),
        )

    @property
    def cam(self) -> dict:
        return self.coordinator.camera(self.camera_name) or {}

    @property
    def available(self) -> bool:
        return super().available and self.coordinator.camera(self.camera_name) is not None


def track_cameras(coordinator: KestrelCoordinator, entry, async_add_entities, factory) -> None:
    """Legt Entitaeten an - auch fuer Kameras, die spaeter in Kestrel dazukommen."""
    known: set[str] = set()

    def _check() -> None:
        new = [n for n in (coordinator.data or {}).get("by_name", {}) if n not in known]
        if new:
            known.update(new)
            async_add_entities([e for n in new for e in factory(n)])

    _check()
    entry.async_on_unload(coordinator.async_add_listener(_check))
