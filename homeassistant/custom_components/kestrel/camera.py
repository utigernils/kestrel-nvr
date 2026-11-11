"""Kamerabilder: Standbild und Live-M-JPEG, durch Home Assistant durchgereicht."""
from __future__ import annotations

import aiohttp
from aiohttp import web

from homeassistant.components.camera import Camera
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_aiohttp_proxy_web, async_get_clientsession
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import KestrelError
from .const import CONF_VERIFY_SSL
from .entity import KestrelCameraEntity, track_cameras


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator = entry.runtime_data
    track_cameras(coordinator, entry, async_add_entities, lambda name: [KestrelCamera(coordinator, name)])


class KestrelCamera(KestrelCameraEntity, Camera):
    _attr_name = None            # traegt den Namen des Geraets
    _attr_is_streaming = True

    def __init__(self, coordinator, camera: str) -> None:
        KestrelCameraEntity.__init__(self, coordinator, camera, "camera")
        Camera.__init__(self)
        self._attr_brand = "MOBOTIX"

    @property
    def available(self) -> bool:
        return KestrelCameraEntity.available.fget(self) and bool(self.cam.get("online"))

    @property
    def extra_state_attributes(self) -> dict:
        c = self.cam
        return {"width": c.get("width"), "height": c.get("height"), "fps": c.get("fps")}

    async def async_camera_image(self, width: int | None = None, height: int | None = None) -> bytes | None:
        try:
            return await self.coordinator.client.image(self.camera_name)
        except KestrelError:
            return None

    async def handle_async_mjpeg_stream(self, request: web.Request) -> web.StreamResponse | None:
        client = self.coordinator.client
        session = async_get_clientsession(self.hass, verify_ssl=self.coordinator.config_entry.data.get(CONF_VERIFY_SSL, True))
        stream = session.get(client.stream_url(self.camera_name), headers=client.headers,
                             timeout=aiohttp.ClientTimeout(total=None, connect=10, sock_read=30))
        return await async_aiohttp_proxy_web(self.hass, request, stream)
