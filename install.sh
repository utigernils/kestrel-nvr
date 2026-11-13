#!/usr/bin/env bash
# Kestrel NVR - Installer und Updater
#
#   sudo bash install.sh              Neuinstallation (fragt nach Kamera und Admin-Konto)
#                                     oder Update, wenn schon eine Installation gefunden wird
#   sudo bash install.sh --update     nur aktualisieren, Konfiguration und Aufnahmen bleiben
#   sudo bash install.sh --yes        Rueckfragen beim Update ueberspringen
#   sudo bash install.sh --fresh      Neuinstallation erzwingen
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="kestrel-nvr"
NAME="kestrel-nvr"
POINTER="/etc/kestrel-nvr.conf"
MODEL_URL="https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx"
NEW_VER="$(cat "$SRC/VERSION" 2>/dev/null || echo 0.0.0)"

MODE=""; YES=0
for a in "$@"; do
  case "$a" in
    --update) MODE="update" ;;
    --fresh)  MODE="fresh" ;;
    --yes|-y) YES=1 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
  esac
done

c_b=$'\033[1m'; c_g=$'\033[32m'; c_y=$'\033[33m'; c_r=$'\033[31m'; c_0=$'\033[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$c_g" "$c_0" "$*"; }
warn() { printf '%s!%s %s\n' "$c_y" "$c_0" "$*"; }
die()  { printf '%s✗ %s%s\n' "$c_r" "$*" "$c_0" >&2; exit 1; }

ask() {          # ask VAR "Frage" "Standard"
  local __var=$1 __q=$2 __def=${3-} __in
  if [ -n "$__def" ]; then read -r -p "$__q [$__def]: " __in || true; else read -r -p "$__q: " __in || true; fi
  printf -v "$__var" '%s' "${__in:-$__def}"
}
ask_secret() {   # ask_secret VAR "Frage"
  local __var=$1 __q=$2 __in
  read -r -s -p "$__q: " __in || true; echo
  printf -v "$__var" '%s' "$__in"
}
yesno() {        # yesno "Frage" J|N
  local __in __def=${2:-J}
  read -r -p "$1 [$( [ "$__def" = J ] && echo 'J/n' || echo 'j/N' )]: " __in || true
  __in=${__in:-$__def}
  [[ $__in =~ ^[JjYy] ]]
}
yq() { printf "'%s'" "${1//\'/\'\'}"; }       # YAML: einfach gequotet, ' wird verdoppelt

say "${c_b}Kestrel NVR ${NEW_VER}${c_0} – Rekorder für MOBOTIX M-JPEG-Kameras"
say

[ "$(id -u)" -eq 0 ] || die "Bitte als root ausführen:  sudo bash install.sh"
[ -f "$SRC/Dockerfile" ] || die "Dockerfile nicht gefunden – install.sh bitte im entpackten Ordner starten."

# ---------------------------------------------------------------- Docker
if ! command -v docker >/dev/null 2>&1; then
  warn "Docker ist nicht installiert."
  if yesno "Docker jetzt über das offizielle Skript (get.docker.com) installieren?" J; then
    command -v curl >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq curl ca-certificates; }
    curl -fsSL https://get.docker.com | sh
  else
    die "Ohne Docker geht es nicht weiter."
  fi
fi
if ! docker info >/dev/null 2>&1; then
  systemctl enable --now docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1 || true
  sleep 2
  docker info >/dev/null 2>&1 || die "Der Docker-Dienst läuft nicht."
fi
ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo vorhanden)"

# --------------------------------------------- vorhandene Installation finden
BASE=""; DATA=""; WEB_PORT=""; TZ_NAME=""; OLD_VER=""
[ -f "$POINTER" ] && . "$POINTER"
if [ -n "$BASE" ] && [ -f "$BASE/install.env" ]; then
  . "$BASE/install.env"
  OLD_VER="$(cat "$BASE/VERSION" 2>/dev/null || echo unbekannt)"
elif docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  # Installation aus Version 1.0 (noch ohne Merkdatei): Pfade und Port vom Container ablesen
  cfg_src="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Source}}{{end}}{{end}}' "$NAME" 2>/dev/null || true)"
  DATA="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$NAME" 2>/dev/null || true)"
  WEB_PORT="$(docker inspect -f '{{(index (index .HostConfig.PortBindings "5000/tcp") 0).HostPort}}' "$NAME" 2>/dev/null || true)"
  if [ -n "$cfg_src" ] && [ -f "$cfg_src/config.yml" ]; then BASE="$(dirname "$cfg_src")"; OLD_VER="1.0.0"; fi
fi
HAVE_INSTALL=0
[ -n "$BASE" ] && [ -f "$BASE/config/config.yml" ] && [ -n "$DATA" ] && [ -n "$WEB_PORT" ] && HAVE_INSTALL=1

if [ "$MODE" = "update" ] && [ "$HAVE_INSTALL" -ne 1 ]; then die "Keine vorhandene Installation gefunden – bitte ohne --update starten."; fi
if [ -z "$MODE" ]; then
  if [ "$HAVE_INSTALL" -eq 1 ]; then MODE="update"; else MODE="fresh"; fi
fi

if [ "$MODE" = "update" ]; then
  say "${c_b}Update${c_0}: Version ${OLD_VER:-unbekannt} → ${NEW_VER}"
  say "  Konfiguration: $BASE/config/config.yml"
  say "  Aufnahmen:     $DATA"
  say "  Port:          $WEB_PORT"
  say "Konfiguration, Benutzer und Aufnahmen bleiben unverändert."
  if [ "$YES" -ne 1 ]; then yesno "Jetzt aktualisieren?" J || die "Abgebrochen."; fi
  CFG_DIR="$BASE/config"; CFG="$CFG_DIR/config.yml"
  cp -p "$CFG" "$CFG.bak-$(date +%Y%m%d-%H%M%S)"
  ls -1t "$CFG".bak-* 2>/dev/null | tail -n +6 | xargs -r rm -f       # die letzten 5 Sicherungen behalten
else
  # ----------------------------------------------------------- Neuinstallation
  ask BASE "Installationsverzeichnis (Konfiguration)" "/opt/kestrel"
  ask DATA "Verzeichnis für Aufnahmen (viel Platz!)" "$BASE/data"
  CFG_DIR="$BASE/config"; CFG="$CFG_DIR/config.yml"
  mkdir -p "$CFG_DIR" "$DATA"

  WRITE_CFG=1
  if [ -f "$CFG" ]; then
    warn "Es gibt bereits eine Konfiguration: $CFG"
    if yesno "Vorhandene Konfiguration behalten?" J; then WRITE_CFG=0; fi
  fi

  if [ "$WRITE_CFG" -eq 1 ]; then
    say
    say "${c_b}Erste Kamera${c_0}"
    CAM_IP=""
    while [ -z "$CAM_IP" ]; do ask CAM_IP "IP-Adresse der Kamera" ""; done
    ask CAM_PORT "HTTP-Port der Kamera" "80"
    ask CAM_USER "Benutzername der Kamera" "admin"
    ask_secret CAM_PASS "Passwort der Kamera"
    ask CAM_NAME "Name der Kamera (ohne Leerzeichen)" "kamera1"
    CAM_NAME="$(printf '%s' "$CAM_NAME" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9_-]\{1,\}/_/g' -e 's/^_*//' -e 's/_*$//')"
    [ -n "$CAM_NAME" ] || CAM_NAME="kamera1"
    [[ $CAM_PORT =~ ^[0-9]+$ ]] || die "Ungültiger Port: $CAM_PORT"

    # Verbindung pruefen (Zugangsdaten gehen per stdin an curl, nicht ueber die Prozessliste)
    if command -v curl >/dev/null 2>&1; then
      say "Prüfe Verbindung zu $CAM_IP …"
      esc_u=${CAM_USER//\\/\\\\}; esc_u=${esc_u//\"/\\\"}
      esc_p=${CAM_PASS//\\/\\\\}; esc_p=${esc_p//\"/\\\"}
      code=$(printf 'user = "%s:%s"\n' "$esc_u" "$esc_p" | curl -s -K - --anyauth -m 8 -o /dev/null \
             -w '%{http_code}' "http://$CAM_IP:$CAM_PORT/record/current.jpg" 2>/dev/null || true)
      case "$code" in
        200) ok "Kamera antwortet, Anmeldung in Ordnung." ;;
        401|403) warn "Kamera erreichbar, aber Anmeldung abgelehnt (HTTP $code)."
                 yesno "Trotzdem fortfahren?" N || die "Abgebrochen." ;;
        *)   warn "Kamera nicht erreichbar (Antwort: ${code:-keine})."
             yesno "Trotzdem fortfahren?" N || die "Abgebrochen." ;;
      esac
    fi

    say
    say "${c_b}Administrator-Konto für die Weboberfläche${c_0}"
    UI_USER=""
    until [[ $UI_USER =~ ^[A-Za-z0-9._-]{2,32}$ ]]; do ask UI_USER "Benutzername (Buchstaben, Ziffern, . _ -)" "admin"; done
    UI_PASS=""; UI_PASS2="x"
    while :; do
      ask_secret UI_PASS "Passwort (mindestens 8 Zeichen)"
      if [ "${#UI_PASS}" -lt 8 ]; then warn "Zu kurz."; continue; fi
      ask_secret UI_PASS2 "Passwort wiederholen"
      [ "$UI_PASS" = "$UI_PASS2" ] && break
      warn "Die Passwörter stimmen nicht überein."
    done

    say
    say "${c_b}Rekorder${c_0}"
    ask RET "Aufnahmen aufbewahren (Tage, 0 = unbegrenzt)" "7"
    ask MAXGB "Maximaler Speicherplatz in GB (0 = unbegrenzt)" "0"
    [[ $RET =~ ^[0-9]+([.][0-9]+)?$ ]] || RET=7
    [[ $MAXGB =~ ^[0-9]+([.][0-9]+)?$ ]] || MAXGB=0
    say "Abgeschlossene Stunden kann Kestrel im Hintergrund nach H.265 umkodieren. Das spart sehr viel"
    say "Platz, ist aber verlustbehaftet (die Original-JPEGs einer Stunde entfallen danach)."
    H265=true
    yesno "Umkodierung nach H.265 einschalten?" J || H265=false
    THREADS=$(( $(nproc 2>/dev/null || echo 2) >= 4 ? 2 : 1 ))

    umask 077
    cat > "$CFG" <<EOF
# Kestrel NVR - erzeugt von install.sh am $(date '+%Y-%m-%d %H:%M')
cameras:
  - name: $(yq "$CAM_NAME")
    host: $(yq "$CAM_IP")
    port: $CAM_PORT
    scheme: http
    username: $(yq "$CAM_USER")
    password: $(yq "$CAM_PASS")
    sensor: auto
    fps: 0
    extra_params: ''
    detect: true
    enabled: true
storage:
  path: /data
  retention_days: $RET
  max_gb: $MAXGB
  min_free_gb: 2
transcode:
  enabled: $H265
  crf: 26
  preset: veryfast
  threads: 0
  delay_minutes: 2
  cache_gb: 2
  cache_minutes: 30
detect:
  enabled: true
  model: /models/yolox_tiny.onnx
  fps: 2
  threads: $THREADS
  score: 0.45
  labels: [person, bicycle, car, motorcycle, bus, truck, cat, dog, bird]
  motion_gate: true
  stationary_s: 60
# Nur fuer den ersten Start: daraus wird das Admin-Konto angelegt, danach leert Kestrel die Felder.
ui:
  username: $(yq "$UI_USER")
  password: $(yq "$UI_PASS")
EOF
    chmod 600 "$CFG"
    umask 022
    ok "Konfiguration geschrieben: $CFG"
  fi

  ask WEB_PORT "Port der Weboberfläche" "${WEB_PORT:-5000}"
  [[ $WEB_PORT =~ ^[0-9]+$ ]] || die "Ungültiger Port: $WEB_PORT"
fi

if [ -z "$TZ_NAME" ]; then
  TZ_NAME="$(cat /etc/timezone 2>/dev/null || true)"
  [ -n "$TZ_NAME" ] || TZ_NAME="$(readlink /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||' || true)"
  [ -n "$TZ_NAME" ] || TZ_NAME="Europe/Zurich"
fi

# ----------------------------------------------------------------- Modell
mkdir -p "$SRC/models"
if [ ! -s "$SRC/models/yolox_tiny.onnx" ]; then
  say "Lade Erkennungsmodell …"
  curl -fL --retry 3 -o "$SRC/models/yolox_tiny.onnx" "$MODEL_URL" \
    || warn "Download fehlgeschlagen – das Image versucht es beim Bauen erneut."
fi

# ------------------------------------------------------------------ Image
HAD_PREV=0
if docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then
  docker tag "$IMAGE:latest" "$IMAGE:previous"          # fuer "kestrel rollback"
  HAD_PREV=1
fi
say
say "${c_b}Baue Docker-Image${c_0} (dauert beim ersten Mal ein paar Minuten) …"
if ! docker build -t "$IMAGE:latest" -t "$IMAGE:$NEW_VER" "$SRC"; then
  # Haeufigste Ursache: die Oberflaeche liess sich nicht bauen (npm-Registry nicht erreichbar).
  # Zweiter Versuch mit der mitgelieferten, vorgebauten Oberflaeche.
  if [ -f "$SRC/app/web/index.html" ]; then
    warn "Build fehlgeschlagen – zweiter Versuch mit der vorgebauten Oberfläche …"
    docker build --build-arg WEB_MODE=pre -t "$IMAGE:latest" -t "$IMAGE:$NEW_VER" "$SRC" \
      || die "Build fehlgeschlagen – die laufende Installation wurde nicht angefasst."
  else
    die "Build fehlgeschlagen – die laufende Installation wurde nicht angefasst."
  fi
fi
ok "Image $IMAGE:$NEW_VER gebaut."

run_container() {    # run_container IMAGE-TAG
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" --restart unless-stopped \
    -p "$WEB_PORT:5000" \
    -v "$CFG_DIR:/config" \
    -v "$DATA:/data" \
    -e "TZ=$TZ_NAME" \
    --log-opt max-size=10m --log-opt max-file=3 \
    "$1" >/dev/null
}
wait_up() {
  local i
  for i in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = "true" ] || return 1
    if docker exec "$NAME" python tools/healthcheck.py >/dev/null 2>&1; then return 0; fi
    printf "."; sleep ${KESTREL_TEST_SLEEP:-1}
  done
  return 1
}

run_container "$IMAGE:latest"
printf 'Starte Container '
if wait_up; then
  echo; ok "Container „$NAME“ läuft."
else
  echo
  warn "Die neue Version startet nicht. Letzte Log-Zeilen:"
  docker logs --tail 30 "$NAME" 2>&1 || true
  if [ "$MODE" = "update" ] && [ "$HAD_PREV" -eq 1 ]; then
    warn "Stelle die vorherige Version wieder her …"
    docker tag "$IMAGE:previous" "$IMAGE:latest"
    run_container "$IMAGE:latest"
    if wait_up; then echo; die "Update fehlgeschlagen – die vorherige Version läuft wieder."; fi
    echo
  fi
  die "Start fehlgeschlagen – siehe Log oben."
fi

# ------------------------------------------------- Merkdatei und Helfer
umask 022
cat > "$BASE/install.env" <<EOF
# Kestrel NVR - vom Installer geschrieben, wird beim Update gelesen
BASE=$(printf '%q' "$BASE")
DATA=$(printf '%q' "$DATA")
WEB_PORT=$(printf '%q' "$WEB_PORT")
TZ_NAME=$(printf '%q' "$TZ_NAME")
EOF
printf 'BASE=%q\n' "$BASE" > "$POINTER"
printf '%s\n' "$NEW_VER" > "$BASE/VERSION"
install -m 755 "$SRC/kestrel" /usr/local/bin/kestrel 2>/dev/null || warn "Konnte /usr/local/bin/kestrel nicht anlegen."
if [ -d "$SRC/homeassistant" ]; then
  rm -rf "$BASE/homeassistant"; cp -r "$SRC/homeassistant" "$BASE/homeassistant"
fi
docker image prune -f >/dev/null 2>&1 || true

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
say
if [ "$MODE" = "update" ]; then
  ok "${c_b}Aktualisiert auf Version $NEW_VER.${c_0}"
  say "  Falls nötig zurück zur alten Version:  sudo kestrel rollback"
  if [ "$OLD_VER" = "1.0.0" ]; then
    warn "Neu in dieser Version: Anmeldung. Beim ersten Öffnen der Oberfläche legst du das Administrator-Konto an – bitte gleich erledigen."
  fi
else
  ok "${c_b}Fertig – Version $NEW_VER installiert.${c_0}"
fi
say "  Oberfläche:      http://${HOST_IP:-<host-ip>}:$WEB_PORT"
say "  Konfiguration:   $CFG"
say "  Aufnahmen:       $DATA"
say "  Home Assistant:  Integration liegt unter $BASE/homeassistant (siehe README dort)"
say
say "  Befehle:  kestrel status | logs | restart | passwd NAME | update DATEI.zip | rollback"
