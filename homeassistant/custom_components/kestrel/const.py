"""Konstanten der Kestrel-NVR-Integration."""
from datetime import timedelta

DOMAIN = "kestrel"

CONF_SSL = "ssl"
CONF_VERIFY_SSL = "verify_ssl"
CONF_TOKEN = "token"
CONF_INSTANCE_ID = "instance_id"

# Name des Ereignisses auf dem Home-Assistant-Bus
EVENT_KESTREL = "kestrel_event"

DEFAULT_PORT = 5000
# Die Abfrage ist nur noch Rueckfall und liefert Messwerte; Ereignisse kommen per Push.
SCAN_INTERVAL = timedelta(seconds=5)

VEHICLE_LABELS = {"car", "truck", "bus", "motorcycle", "bicycle"}
ANIMAL_LABELS = {"cat", "dog", "bird", "horse", "sheep", "cow"}
