# Kestrel NVR – Home Assistant integration

*Deutsch: weiter unten.*

## Install

1. Copy the folder `custom_components/kestrel` to `<Home Assistant config>/custom_components/kestrel`
   (on Home Assistant OS e.g. with the Samba or File editor add-on to `/config/custom_components/kestrel`).
2. Restart Home Assistant.
3. *Settings → Devices & services → Add integration → “Kestrel NVR”*.
4. Enter the IP address (and port, default 5000) of the recorder.
5. Home Assistant shows a six-digit code. In Kestrel, signed-in administrators see a notice with
   the same code at the top → **Allow**.
6. Click *Submit* in Home Assistant. Done.

When updating from an older version: replace the folder and restart Home Assistant. The new
entities appear automatically; no new pairing is needed.

## What you get

One device per camera:

| Entity | Description |
|---|---|
| `camera.<name>` | still image and live view (M-JPEG, proxied by Home Assistant) |
| `binary_sensor.<name>_person` | on while a person is detected – switches instantly |
| `binary_sensor.<name>_vehicle` | car, truck, bus, motorcycle, bicycle |
| `binary_sensor.<name>_animal` | cat, dog, bird … |
| `binary_sensor.<name>_object_detected` | any detected object (attribute `labels`) |
| `binary_sensor.<name>_connection` | camera delivers images |
| `image.<name>_last_event` | **snapshot of the last event** (attributes `event_id`, `label`, `score`) |
| `event.<name>_detection` | fires `detected` / `ended` with `label`, `score`, `event_id` |
| `sensor.<name>_last_event`, `…_last_event_time` | kind and time of the last event |
| `sensor.<name>_frame_rate` | current frame rate |

Plus the device “Kestrel NVR” with used and free storage, “storage lasts for … days”, CPU, version
and a problem sensor that turns on when storage runs short or recording is paused.

### Push events

The integration keeps one connection to Kestrel open (Server-Sent Events,
`/api/ha/events/stream`). Kestrel reports the start, every improvement (better picture / higher
score) and the end of a detection the moment it happens. If the connection drops, the integration
reconnects (2 s … 60 s) and the regular poll every 5 seconds fills the gap.

Every report is also fired on the Home Assistant bus as **`kestrel_event`**:

| Field | Meaning |
|---|---|
| `type` | `start`, `update` or `end` |
| `camera`, `label`, `score` | camera name, object class (COCO name such as `person`), confidence 0–1 |
| `event_id` | id of the event in Kestrel |
| `start_time`, `end_time` | ISO timestamps (UTC); `end_time` only for `end` |
| `active` | `false` once the event has ended |
| `camera_entity`, `image_entity` | the matching entities, e.g. `camera.eingang`, `image.eingang_last_event` |

The image entity is updated *before* the bus event fires, so an automation that reacts to the event
already finds the new picture.

### Example: notification with picture

```yaml
automation:
  - alias: Person at the entrance
    trigger:
      - platform: event
        event_type: kestrel_event
        event_data:
          type: start
          camera: eingang
          label: person
    action:
      - service: notify.mobile_app_my_phone
        data:
          title: Person at the entrance
          message: "Confidence {{ (trigger.event.data.score * 100) | round }} %"
          data:
            image: "{{ state_attr(trigger.event.data.image_entity, 'entity_picture') }}"
            tag: "kestrel-{{ trigger.event.data.event_id }}"
```

`entity_picture` is the Home Assistant path of the snapshot (`/api/image_proxy/…`) including its
access token; the companion app loads it through Home Assistant, so the phone never needs to reach
Kestrel directly. Using the same `tag` for a second automation on `type: end` replaces the
notification with the final, best picture. For the live picture instead, use
`image: /api/camera_proxy/camera.eingang`.

A simple state trigger still works: `binary_sensor.eingang_person` → `on`.

### Token API (for your own scripts)

Read-only, with `Authorization: Bearer <token>`:

```
GET /api/ha/state                         cameras, active labels, system values
GET /api/ha/events?camera=&label=&limit=  recent events
GET /api/ha/events/stream                 Server-Sent Events (start / update / end)
GET /api/ha/events/<id>/snapshot.jpg      best picture of an event
GET /api/ha/events/<id>/thumb.jpg         small crop
GET /api/ha/events/<id>/preview           list of preview frames, …/preview/<n>.jpg
GET /api/ha/cameras/<name>/latest.jpg     current picture
GET /api/ha/cameras/<name>/live.mjpg      live M-JPEG
```

### Why no MQTT?

Frigate uses MQTT because it predates a native integration. For Kestrel it would add a broker as a
dependency, a second set of credentials, a client library in the container and a second, parallel
way to create the same entities (MQTT discovery) – and the result would not be faster than the
push connection above. So it is left out on purpose. If you need MQTT for other consumers, a
Home Assistant automation on `kestrel_event` can publish with `mqtt.publish`.

## Security

- The integration never gets a user password. After approval it receives its own random token that
  can only read (`/api/ha/*`) and cannot change anything.
- The token is transmitted exactly once; Kestrel stores only its hash.
- Only a signed-in administrator can approve. The code protects against accidentally approving
  someone else's request. Requests expire after 10 minutes.
- Under *Settings → Home Assistant* in Kestrel, access can be revoked at any time. Home Assistant
  then offers “Reconnect”.
- In the home network the connection is plain HTTP, i.e. unencrypted. Anyone who can read the
  token on the network can fetch images. For routes outside your own network put a reverse proxy
  with HTTPS in front and enable “Use HTTPS” in the integration.

---

# Deutsch

## Installieren

1. Den Ordner `custom_components/kestrel` nach `<Home-Assistant-Konfiguration>/custom_components/kestrel` kopieren.
2. Home Assistant neu starten.
3. *Einstellungen → Geräte & Dienste → Integration hinzufügen → „Kestrel NVR“*.
4. IP-Adresse (und Port, Standard 5000) des Rekorders eingeben.
5. Home Assistant zeigt einen sechsstelligen Code. In Kestrel erscheint bei angemeldeten
   Administratoren oben ein Hinweis mit demselben Code → **Erlauben**.
6. In Home Assistant auf *Absenden* klicken.

Beim Update von einer älteren Version: Ordner ersetzen, Home Assistant neu starten. Die neuen
Entitäten erscheinen von selbst, eine neue Kopplung ist nicht nötig.

## Neu in 1.4

- **Push statt Warten:** Die Integration hält eine Verbindung zu Kestrel offen und erfährt Beginn,
  Verbesserung und Ende jeder Erkennung sofort. Die Binärsensoren schalten ohne Verzögerung; die
  Abfrage alle 5 Sekunden ist nur noch Rückfall und liefert Messwerte.
- **Bus-Ereignis `kestrel_event`** mit `type` (`start`/`update`/`end`), `camera`, `label`, `score`,
  `event_id`, `start_time`, `end_time`, `camera_entity`, `image_entity`.
- **`image.<name>_last_event`:** Foto des letzten Ereignisses – wird aktualisiert, bevor das
  Bus-Ereignis feuert.
- **`event.<name>_detection`:** meldet `detected` / `ended`.

Beispiel-Automation mit Bild:

```yaml
automation:
  - alias: Person am Eingang
    trigger:
      - platform: event
        event_type: kestrel_event
        event_data:
          type: start
          camera: eingang
          label: person
    action:
      - service: notify.mobile_app_mein_handy
        data:
          title: Person am Eingang
          message: "Sicherheit {{ (trigger.event.data.score * 100) | round }} %"
          data:
            image: "{{ state_attr(trigger.event.data.image_entity, 'entity_picture') }}"
            tag: "kestrel-{{ trigger.event.data.event_id }}"
```

**Kein MQTT:** Es bräuchte einen Broker, weitere Zugangsdaten und einen zweiten Weg, dieselben
Entitäten anzulegen – ohne schneller zu sein als die Push-Verbindung. Wer MQTT für andere Abnehmer
braucht, kann in einer Automation auf `kestrel_event` mit `mqtt.publish` weiterleiten.

Alle übrigen Entitäten, die Token-API und die Hinweise zur Sicherheit stehen im englischen Teil oben.
