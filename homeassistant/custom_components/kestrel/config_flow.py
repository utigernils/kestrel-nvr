"""Einrichtung: Adresse eingeben, in Kestrel freigeben, fertig.

Ablauf (wie beim Druck auf die Taste einer Hue-Bridge):
  1. Home Assistant schickt eine Kopplungsanfrage an Kestrel und erhaelt einen 6-stelligen Code.
  2. In Kestrel erscheint bei angemeldeten Administratoren ein Hinweis mit demselben Code.
  3. Nach "Erlauben" holt Home Assistant sein persoenliches Token ab. Es wird genau einmal
     ausgeliefert und nur im Konfigurationseintrag gespeichert.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import KestrelClient, KestrelConnectionError, KestrelError, KestrelRateLimited
from .const import (CONF_INSTANCE_ID, CONF_SSL, CONF_TOKEN, CONF_VERIFY_SSL, DEFAULT_PORT, DOMAIN)

USER_SCHEMA = vol.Schema({
    vol.Required(CONF_HOST): str,
    vol.Required(CONF_PORT, default=DEFAULT_PORT): vol.All(int, vol.Range(min=1, max=65535)),
    vol.Optional(CONF_SSL, default=False): bool,
    vol.Optional(CONF_VERIFY_SSL, default=True): bool,
})


class KestrelConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._conn: dict[str, Any] = {}
        self._pair: dict[str, Any] = {}
        self._client: KestrelClient | None = None
        self._reauth = False

    def _make_client(self) -> KestrelClient:
        session = async_get_clientsession(self.hass, verify_ssl=self._conn.get(CONF_VERIFY_SSL, True))
        return KestrelClient(session, self._conn[CONF_HOST], self._conn[CONF_PORT], self._conn.get(CONF_SSL, False))

    async def _start_pairing(self) -> str | None:
        """Kopplung anfragen. Liefert einen Fehlerschluessel oder None."""
        self._client = self._make_client()
        name = f"Home Assistant ({self.hass.config.location_name})" if self.hass.config.location_name else "Home Assistant"
        try:
            self._pair = await self._client.pair_request(name)
        except KestrelRateLimited:
            return "rate_limited"
        except KestrelConnectionError:
            return "cannot_connect"
        except KestrelError:
            return "unknown"
        if "id" not in self._pair or "secret" not in self._pair:
            return "unknown"
        return None

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            self._conn = dict(user_input)
            self._conn[CONF_HOST] = self._conn[CONF_HOST].strip().removeprefix("http://").removeprefix("https://").strip("/")
            err = await self._start_pairing()
            if err is None:
                await self.async_set_unique_id(self._pair.get("instance_id"))
                self._abort_if_unique_id_configured()
                return await self.async_step_link()
            errors["base"] = err
        return self.async_show_form(step_id="user", data_schema=self.add_suggested_values_to_schema(USER_SCHEMA, self._conn),
                                    errors=errors)

    async def async_step_link(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            assert self._client is not None
            try:
                res = await self._client.pair_poll(self._pair["id"], self._pair["secret"])
            except KestrelError:
                res = {"status": "error"}
            status = res.get("status")
            if status == "approved" and res.get("token"):
                data = {**self._conn, CONF_TOKEN: res["token"], CONF_INSTANCE_ID: self._pair.get("instance_id")}
                if self._reauth:
                    return self.async_update_reload_and_abort(self._get_reauth_entry(), data=data)
                return self.async_create_entry(title=f"Kestrel NVR ({self._conn[CONF_HOST]})", data=data)
            if status == "denied":
                return self.async_abort(reason="denied")
            if status == "pending":
                errors["base"] = "not_approved"
            elif status == "error":
                errors["base"] = "cannot_connect"
            else:                               # abgelaufen -> neue Anfrage, neuer Code
                err = await self._start_pairing()
                errors["base"] = err or "expired"
        code = str(self._pair.get("code", ""))
        return self.async_show_form(
            step_id="link", data_schema=vol.Schema({}), errors=errors,
            description_placeholders={"code": f"{code[:3]} {code[3:]}", "url": self._client.base if self._client else ""},
        )

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        self._reauth = True
        self._conn = {k: entry_data[k] for k in (CONF_HOST, CONF_PORT, CONF_SSL, CONF_VERIFY_SSL) if k in entry_data}
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            err = await self._start_pairing()
            if err is None:
                return await self.async_step_link()
            errors["base"] = err
        return self.async_show_form(step_id="reauth_confirm", data_schema=vol.Schema({}), errors=errors)
