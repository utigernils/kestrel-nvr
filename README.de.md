# Kestrel NVR

Schlanker Netzwerk-Videorekorder im Stil von Frigate. Entwickelt für den **M-JPEG-Strom von
MOBOTIX-Kameras** (M12D-Sec-DNight und alle Modelle mit `faststream.jpg`), nimmt aber auch
**aktuelle Kameras mit H.264/H.265 über RTSP** und andere M-JPEG-Kameras auf. Läuft vollständig
auf der CPU. *English version: [README.md](README.md)*

Änderungen je Version stehen in `CHANGELOG.de.md` (englisch: `CHANGELOG.md`) und unter *Einstellungen → Changelog*. Die Versionsnummer steht in `VERSION`,
unten in der Navigation und auf der Seite *System*.

## Installation

```bash
unzip kestrel-nvr.zip && cd kestrel
sudo bash install.sh
```

Der Installer fragt nach IP, Benutzer und Passwort der ersten Kamera und nach einem
Administrator-Konto für die Oberfläche, baut das Docker-Image und startet den Container
`kestrel-nvr` (Autostart nach Reboot). Danach: `http://<host-ip>:5000`.

## Aktualisieren

Neues ZIP auf den Host kopieren, dann:

```bash
sudo kestrel update /pfad/kestrel-nvr.zip
```

(oder entpacken und `sudo bash install.sh` – eine vorhandene Installation wird erkannt.)
Konfiguration, Benutzer und Aufnahmen bleiben erhalten, `config.yml` wird vorher gesichert.
Startet die neue Version nicht, stellt der Installer die alte automatisch wieder her.
Von Hand zurück: `sudo kestrel rollback`.

Weitere Befehle: `kestrel status | logs | restart | users | passwd NAME | adduser NAME [admin|viewer] | uninstall`.
Passwort vergessen: `sudo kestrel passwd <name>`.

## Was es macht

| Bereich | Funktion |
|---|---|
| **Aufnahme** | 24/7. Jedes JPEG wird unverändert gespeichert (kein Dekodieren, kein Neukodieren), mit eigenem Zeitstempel in Millisekunden. Keine feste Bildrate. |
| **Live** | Kamerabild in Originalqualität, Status, Bildrate, Datenrate, Erkennungs-Boxen. |
| **Aufnahmen** | Player mit Zeitleiste. Spielt die Bilder mit exakt den Abständen ab, in denen sie ankamen. 0,25× bis 16×, Einzelbildschritt, Lücken werden übersprungen, Sprung zum nächsten Ereignis, Originalbild-Download. |
| **Ereignisse** | Objekte (Person, Auto, …) werden verfolgt und als Ereignis abgelegt. Jedes Ereignis hat eine Vorschau als kurze Bildfolge (Maus darüber oder ▶ antippen). |
| **Anmeldung** | Login-Seite, Benutzerverwaltung mit den Rollen Administrator und Betrachter. |
| **H.265** | Jede abgeschlossene Stunde wird im Hintergrund mit niedrigster Priorität nach H.265 umkodiert. Die Zeitstempel der Einzelbilder bleiben, die Wiedergabe läuft weiter ungleichmäßig. |
| **Speicherwächter** | Hält immer Platz frei, löscht das Älteste zuerst, warnt, wenn der Platz nicht für die eingestellte Aufbewahrung reicht. |
| **Home Assistant** | Eigene Integration mit Freigabe durch einen Administrator, Ereignissen per Push und Bildern, siehe `homeassistant/README.md`. |
| **Sprachen, Handy** | Deutsch und Englisch; für das Handy optimiert und als App installierbar. |

## Kameratypen

| Typ | Für | Aufzeichnung |
|---|---|---|
| `mobotix` | MOBOTIX mit `faststream.jpg` | Jedes JPEG unverändert, später Umkodierung nach H.265 |
| `rtsp` | Aktuelle Kameras (ONVIF/RTSP, H.264 oder H.265) | Video so, wie die Kamera es liefert – keine Neukodierung |
| `mjpeg` | Andere Kameras mit M-JPEG über HTTP | wie `mobotix` |

Der Installer richtet die erste Kamera als MOBOTIX ein; weitere Kameras aller Typen fügt man
unter *Einstellungen → Kameras* hinzu.

**MOBOTIX:**

```
http://<ip>/control/faststream.jpg?stream=full&needlength&fps=0
```

* `stream=full` – vollständige JPEG-Bilder (M-JPEG) statt MxPEG
* `needlength` – die Kamera schickt pro Bild einen `Content-Length`-Header
* `fps=0` – keine Begrenzung, die Kamera sendet so schnell sie kann
* Anmeldung per HTTP Basic, bei Bedarf Digest. Ohne Benutzer wird der Gastzugang
  `/cgi-bin/faststream.jpg` verwendet.
* Auflösung und JPEG-Qualität legt die Kamera fest: *Setup Menu → Allgemeine Bildeinstellungen*
  und *JPEG-Einstellungen* (MxPEG dort abschalten). Laut Datenblatt schafft die M12 mit M-JPEG etwa
  16 B/s bei VGA, 6 B/s bei MEGA (1280×960) und 4 B/s bei 3MEGA (2048×1536).
* `sensor: auto` übernimmt die Tag/Nacht-Umschaltung der Kamera; `right`, `left` oder `both`
  erzwingen einen Sensor.

**RTSP (H.264/H.265):**

* Ein ffmpeg-Prozess kopiert den Strom ohne Neukodierung in Minuten-Dateien. Er dekodiert nichts,
  das kostet kaum Rechenleistung, und die Qualität ist exakt die der Kamera.
* Ein zweiter Prozess dekodiert das Live-Bild – nur solange die Erkennung für die Kamera an ist
  oder jemand zusieht. Sonst wird gar nichts dekodiert.
* Jedes Bild bekommt seine Empfangszeit als Zeitstempel; Player, Boxen und Einzelbildschritt
  funktionieren wie bei MOBOTIX. Zum Ansehen wird die benötigte Minute dekodiert.
* Für Live-Bild und Erkennung erzeugt Kestrel einige JPEGs pro Sekunde (`live_fps`, Standard 5).
  Mit einem **Nebenstrom** in kleiner Auflösung (`sub_url`) muss der Hauptstrom dafür nicht
  dekodiert werden – das spart am meisten Rechenleistung.
* Die Adresse steht im Handbuch der Kamera, z. B. `rtsp://192.168.1.60:554/stream1`. Angenommen
  wird alles, was ffmpeg lesen kann (auch `rtsps://`, `http://`, `rtmp://`).
* Nicht enthalten: ONVIF-Suche im Netz, Ton, Schwenken/Neigen.

## H.265 und Speicher

**Umkodierung:** Zwei Minuten nach jeder vollen Stunde wandelt Kestrel die Minuten der vergangenen
Stunde mit ffmpeg/libx265 um. Der Vorgang läuft mit `nice 19`, I/O-Klasse „idle“ und standardmäßig
der halben Kernzahl, damit Aufnahme, Live-Bild und Erkennung Vorrang behalten. Im Test (2 Kerne,
1280×960, ca. 6 B/s) blieben Bildrate und Erkennungszeit während der Umkodierung unverändert; eine
Stunde Material war in rund 12 Minuten fertig.

* Jede Minute wird einzeln geprüft: Stimmt die Bildanzahl des Videos nicht exakt mit dem Index
  überein, bleibt die Minute als JPEG erhalten. Dasselbe gilt für Minuten, in denen die Kamera die
  Auflösung wechselt (Tag-/Nachtsensor).
* Die Zeitstempel bleiben im Index. Das n-te Bild im Video gehört zum n-ten Zeitstempel – die
  Wiedergabe behält die ursprüngliche, ungleichmäßige Bildrate, Boxen und Einzelbildschritt
  funktionieren wie zuvor.
* Zum Ansehen dekodiert Kestrel die benötigte Minute nach `/data/cache`. Die Bilder sind schon
  während des Dekodierens nutzbar, die nächste Minute wird im Voraus vorbereitet. Nach 30 Minuten
  wird sie wieder gelöscht.
* Der volle Wertebereich der JPEGs bleibt erhalten (kein Umrechnen in den Video-Bereich und zurück).
* **H.265 ist verlustbehaftet.** Nach dem Umkodieren gibt es die Original-JPEGs der Stunde nicht
  mehr. Qualität einstellbar: Hoch (CRF 22), Ausgewogen (26), Sparsam (30). Abschaltbar unter
  *Einstellungen → Speicher*.
* Wie viel es spart, hängt vom Bild ab (ruhige Szene: sehr viel, Rauschen und viel Bewegung:
  weniger). Kestrel misst das Verhältnis laufend und zeigt es unter *System* an.

**Reichweite („Platz reicht für“):** Bei JPEG-Kameras liegen die jüngsten Stunden noch als JPEG vor,
alles Ältere als H.265; das Video von RTSP-Kameras bleibt, wie es ist. Kestrel rechnet beide Teile getrennt: frische Stunden (inklusive eines eventuellen Rückstands
der Umkodierung) mit der vollen Datenrate der Kamera, den Rest mit dem gemessenen Verhältnis.
Solange noch nichts umkodiert wurde, wird das Verhältnis geschätzt und als „geschätzt“ markiert.
Derselbe Wert geht an Home Assistant.

**Speicherwächter:** prüft alle 10 Sekunden.
1. Frei bleiben soll immer das Größere aus „Mindestens frei halten“ (Standard 2 GB) und dem Bedarf
   der nächsten 15 Minuten.
2. Wird es knapp, verschwinden die ältesten Stunden – unabhängig von der Aufbewahrungsdauer.
3. Ist nur noch der heutige Tag da, wird minutenweise gelöscht (Ringpuffer). Die Aufnahme läuft weiter.
4. Belegt etwas anderes den Datenträger restlos, pausiert die Aufnahme (Live läuft weiter) und setzt
   automatisch fort, sobald wieder Platz ist.

Warnungen erscheinen oben in der Oberfläche, wenn der Platz nicht für die eingestellte Aufbewahrung
reicht oder die Umkodierung mehr als sechs Stunden im Rückstand ist.

## Anmeldung und Sicherheit

* Passwörter: scrypt mit Salt. Sitzungen: zufälliges Token im HttpOnly-Cookie, in der Datenbank
  liegt nur der Hash. Sitzungen laufen nach 30 Tagen ohne Nutzung ab; ein Passwortwechsel meldet
  alle Geräte ab.
* Fünf Fehlversuche von einer Adresse sperren die Anmeldung für 30 Sekunden, danach jeweils doppelt
  so lang (bis 15 Minuten).
* Betrachter sehen Live, Aufnahmen, Ereignisse und System, können aber nichts ändern.
* Ändernde Anfragen brauchen einen eigenen Header (Schutz gegen CSRF).
* Kestrel spricht HTTP. **Nicht direkt ins Internet stellen** – nur per VPN oder hinter einem
  Reverse-Proxy mit HTTPS und möglichst einer zusätzlichen Anmeldung. Die Anmeldesperre zählt die
  Adresse der direkten Gegenstelle; hinter einem Proxy teilen sich alle Nutzer einen Zähler.
* Das Kamera-Passwort steht im Klartext in `config.yml` (Dateirechte 600), weil Kestrel es für die
  Anmeldung an der Kamera braucht.

## Objekterkennung

* Modell: YOLOX (ONNX, COCO-Klassen) über ONNX Runtime auf der CPU. Unter *Einstellungen → Erkennung* wählbar: Nano (am schnellsten), Tiny (Standard, im Image enthalten) und S (am genauesten, deutlich langsamer). Ein Klick lädt das Modell von der Release-Seite des YOLOX-Projekts nach `/data/models`; die Datei wird geprüft, der Wechsel gilt sofort.
* Analysiert wird nur ein Teil der Bilder (Standard 2 pro Sekunde). Das JPEG wird dafür direkt
  verkleinert dekodiert (1/2, 1/4, 1/8).
* Ohne Bildänderung läuft das Netz gar nicht (Bewegungs-Gate).
* Die Boxen sind normiert gespeichert und werden im Player über das Bild gelegt; zwischen zwei
  Analysen wird interpoliert.
* YOLO26n und YOLO26s (Ultralytics, **AGPL-3.0**) liegen dem Paket bei: YOLO26n ist etwa so schnell
  wie YOLOX-Tiny und deutlich genauer, YOLO26s am genauesten und rund dreimal langsamer. Was die
  Lizenz bei einer Weitergabe bedeutet, steht in `models/README.md`.
* Eigenes Modell: eine ONNX-Datei mit den 80 COCO-Klassen unter *Einstellungen → Erkennung*
  hochladen. Unterstützt: YOLOX `[1, N, 85]`, YOLOv8/YOLO11 `[1, 84, N]`, End-to-End `[1, N, 6]`.

## Speicherformat

```
/data/recordings/<kamera>/<JJJJ-MM-TT>/<HH>/<MM>.idx   je Bild 16 Byte: Zeit ms (u64), Offset (u32), Länge (u32)
/data/recordings/<kamera>/<JJJJ-MM-TT>/<HH>/<MM>.mjr   frisch: JPEGs der Minute hintereinander (UTC)
/data/recordings/<kamera>/<JJJJ-MM-TT>/<HH>/<MM>.mkv   Video: umkodiert (H.265) oder direkt von einer RTSP-Kamera
/data/ingest/<kamera>/                                 RTSP: Segment, das gerade geschrieben wird
/data/recordings/<kamera>/<JJJJ-MM-TT>/<HH>/<MM>.skip  Markierung: diese Minute bleibt JPEG
/data/cache/                                           zum Ansehen dekodierte Minuten
/data/models/                                          heruntergeladene und eigene Erkennungsmodelle
/data/kestrel.db                                       Ereignisse, Vorschauen, Erkennungen, Benutzer (SQLite)
```

Platzbedarf vor der Umkodierung grob: Bildgröße × Bildrate. 1280×960 mit 6 B/s und 150 KB pro Bild
sind etwa 75 GB pro Tag.

## Oberfläche (React)

Der Quellcode liegt in `web/` (React 19, TypeScript, Vite), gebaut wird nach `app/web/`.

```
web/src/api/           typisierter API-Client
web/src/context/       Anmeldung, Einstellungen, Meldungen, Dialoge
web/src/hooks/         usePolling, useLocalStorage, useMediaQuery
web/src/i18n/          Sprachdateien und die kleine Übersetzungshilfe
web/src/lib/player/    Wiedergabe-Engine (variable Bildrate) und Zeitleiste
web/src/components/    ui/ (eigene Bausteine), layout/, reactbits/ (übernommene Komponenten)
web/src/features/      live, events, recordings, system, settings, auth
```

Entwickeln: `cd web && npm ci && npm run dev` (leitet `/api` an `localhost:5000` weiter).
Bauen: `npm run build`. Das Docker-Image baut die Oberfläche selbst; ohne Zugriff auf die
npm-Registry nimmt der Installer automatisch die mitgelieferte, vorgebaute Fassung
(`docker build --build-arg WEB_MODE=pre .`).

### Themes

Zwei Themes, jeweils hell und dunkel, wählbar unter *Einstellungen → Darstellung* (gespeichert im
Browser, „Automatisch“ folgt dem Betriebssystem):

* **Kestrel** – farbiger, bewegter Hintergrund, matte Leiste am unteren Rand, weiße bzw. schwarze
  Schrift, deckende Karten. Das Tempo des Farbverlaufs ist einstellbar (bis „steht still“); im
  Player ruht er.
* **Levin** – sachlich und dicht: Seitenleiste, kleine Radien, eine Akzentfarbe, kein Hintergrund.

Alle Farben stehen an einer Stelle, `web/src/lib/theme.ts`. Ein weiteres Theme ist eine weitere
Palette dort.

Von [React Bits](https://reactbits.dev) stammen im Kestrel-Theme: Aurora (Hintergrund),
RubberSegment, SquishSwitch, CountUp und LatticeLoader. Das Levin-Theme nutzt davon
nichts.

### Sprachen

Deutsch und Englisch, wählbar unter *Einstellungen → Darstellung* („Automatisch“ nimmt die Sprache
des Browsers). Eine Sprache hinzufügen:

1. `web/src/i18n/en.ts` nach `<code>.ts` kopieren (z. B. `fr.ts`), den Export umbenennen und die
   Texte übersetzen. Als Typ `Record<Key, string>` angeben – TypeScript meldet dann jeden fehlenden
   Schlüssel.
2. In `web/src/i18n/index.ts` bei `CATALOGS` und `LANGUAGES` eintragen.
3. Optional `CHANGELOG.<code>.md` anlegen; sonst erscheint das englische Changelog.

Der Server schickt für Fehler und Warnungen **Codes**; die Texte dazu sind die Schlüssel `err.*`
und `warn.*`.

### Handy und „Zum Startbildschirm hinzufügen“

Die Oberfläche passt sich dem Handy an (Tippflächen mindestens 44 px, Dialoge als Blatt von unten,
Player im Querformat). Unter *Einstellungen → Darstellung → Wie eine App nutzen* gibt es den Knopf
**Zum Startbildschirm hinzufügen**.

* Chrome und Edge bieten den Installationsdialog nur in sicherem Kontext an, also über HTTPS oder
  `localhost`. Über `http://<LAN-IP>:5000` zeigt Kestrel stattdessen eine Anleitung; über das
  Browser-Menü → *Zum Startbildschirm hinzufügen* geht es trotzdem, die Seite öffnet dann aber
  eventuell mit Browserleiste und ohne Service Worker.
* Für die volle App-Wirkung einen Reverse-Proxy mit HTTPS vor Kestrel setzen.
* iPhone/iPad: Safari → Teilen → *Zum Home-Bildschirm*.

Der Service Worker puffert nur die App-Hülle (HTML, JS, CSS) – nie Daten, Bilder, Live-Ströme oder
Video unter `/api/`.

## Testen ohne Kamera

`python3 tools/fake_mobotix.py --port 8081` simuliert eine MOBOTIX mit schwankender Bildrate
(Benutzer `admin`, Passwort `meinsm`).

## Nicht enthalten

Kein Ton, kein MxPEG, kein Video-Export (Einzelbilder lassen sich herunterladen), keine Zonen/Masken,
kein MQTT.

## Lizenz

**Für dieses Projekt wurde noch keine Lizenz gewählt.** Solange keine `LICENSE`-Datei beiliegt,
sind keine Nutzungs-, Änderungs- oder Verbreitungsrechte eingeräumt.

Fremde Bestandteile:


Das Erkennungsmodell `models/yolox_tiny.onnx` stammt aus dem Projekt YOLOX (Megvii, Apache-2.0).
`models/yolo26n.onnx` und `models/yolo26s.onnx` stammen von Ultralytics (**AGPL-3.0**); wer kein
AGPL-Material weitergeben will, löscht diese beiden Dateien (siehe `models/README.md`).
Die Komponenten unter `web/src/components/reactbits/` stammen von React Bits (MIT + Commons Clause,
Lizenztext liegt im selben Ordner).
