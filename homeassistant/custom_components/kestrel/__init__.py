"""Kestrel NVR fuer Home Assistant."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PORT, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import KestrelClient
from .const import CONF_SSL, CONF_TOKEN, CONF_VERIFY_SSL
from .coordinator import KestrelCoordinator

PLATFORMS = [Platform.BINARY_SENSOR, Platform.CAMERA, Platform.EVENT, Platform.IMAGE, Platform.SENSOR]

type KestrelConfigEntry = ConfigEntry[KestrelCoordinator]


async def async_setup_entry(hass: HomeAssistant, entry: KestrelConfigEntry) -> bool:
    session = async_get_clientsession(hass, verify_ssl=entry.data.get(CONF_VERIFY_SSL, True))
    client = KestrelClient(session, entry.data[CONF_HOST], entry.data[CONF_PORT],
                           entry.data.get(CONF_SSL, False), entry.data[CONF_TOKEN])
    coordinator = KestrelCoordinator(hass, entry, client)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    coordinator.async_start_push()          # Ereignisse sofort statt erst bei der naechsten Abfrage
    return True


async def async_unload_entry(hass: HomeAssistant, entry: KestrelConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
