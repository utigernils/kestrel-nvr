# Changelog

## 1.4.0 – 11.11.2026

### Neu
- Mehrsprachig: Deutsch und Englisch, wählbar unter Einstellungen → Darstellung; „Automatisch“ nimmt die Sprache des Browsers. Datums- und Zahlenformate, Objektnamen, Fehlermeldungen und das Changelog folgen der Sprache.
- Erkennungsmodell wählbar unter Einstellungen → Erkennung: YOLOX Nano, Tiny und S per Klick herunterladen, eigenes ONNX-Modell hochladen, Wechsel ohne Neustart, Anzeige der Inferenzzeit.
- Home Assistant: Ereignisse kommen sofort per Push. Neues Bus-Ereignis `kestrel_event` (Start, Änderung, Ende), Bild-Entität mit dem Foto des letzten Ereignisses und Ereignis-Entität je Kamera; Binärsensoren schalten ohne Verzögerung.
- Jedes Ereignis speichert ein größeres Foto (Snapshot) des besten Moments.
- Für das Handy optimiert: Tippflächen mindestens 44 px, Dialoge als Blatt von unten, Player im Querformat, kein seitliches Scrollen.
- Als App installierbar: Knopf „Zum Startbildschirm hinzufügen“ unter Einstellungen → Darstellung (der Browser bietet das nur über HTTPS oder localhost an, sonst erscheint eine Anleitung).
- Dezente Übergänge beim Wechsel zwischen Ansichten und Einstellungs-Reitern; aus bei „Bewegung reduzieren“.
- Kestrel-Theme: Tempo des Farbverlaufs einstellbar, bis „steht still“.
- README auf Englisch für die Veröffentlichung, mit Screenshots; die deutsche Fassung liegt als `README.de.md` bei.

### Geändert
- Kestrel-Theme: Die Leiste unten ist deckend und matt, ohne Farbverlauf; ihre Knöpfe sehen aus wie alle anderen.
- Der Benutzer-Knopf in der Leiste führt direkt zu Einstellungen → Konto.
- Die Reiter der Einstellungen zeigen keinen Rollbalken mehr.
- Der Server meldet Fehler und Warnungen als Codes; den Text liefert die Oberfläche in der gewählten Sprache.
- Die Home-Assistant-Integration fragt nur noch alle 5 Sekunden ab (Messwerte), Ereignisse kommen per Push.

## 1.3.0 – 11.11.2026

### Neu
- Themes: „Kestrel“ und „Levin“, jeweils hell und dunkel, wählbar unter Einstellungen → Darstellung. „Automatisch“ folgt dem Betriebssystem.
- Levin-Theme: sachliche Oberfläche mit Seitenleiste, ohne Animationen und Effekte.
- Streaming-Kern unterstützt jetzt drei Kameratypen: MOBOTIX (wie bisher), allgemeine M-JPEG-Kameras über HTTP und Kameras mit H.264/H.265 über RTSP.
- RTSP-Kameras werden ohne Neukodierung aufgezeichnet; für Live-Bild und Erkennung kann ein Nebenstrom in kleiner Auflösung angegeben werden.
- Changelog in den Einstellungen.

### Geändert
- Kestrel-Theme überarbeitet: weiße statt farbiger Schrift, deckende Karten und Hinweise, Anmeldeseite mit Farbverlauf statt Radar.
- Klick-Funken, Farbverlaufs-Text und Lichteffekte auf Karten und Knöpfen entfernt.
- Die Reichweite („Platz reicht für“) rechnet JPEG-Kameras und RTSP-Kameras getrennt.

## 1.2.0 – 11.11.2026

### Neu
- Oberfläche neu in React und TypeScript.
- Ereignisse mit Vorschau als kurze Bildfolge.
- Player mit Ereignisliste des Tages, Tastenkürzeln und tageweisem Blättern.
- Abgeschlossene Stunden werden im Hintergrund nach H.265 umkodiert, mit niedrigster Priorität.

### Geändert
- Die Reichweite berücksichtigt das gemessene Verhältnis von H.265 zu JPEG.
- zip-Archive aus 1.1 entfallen; vorhandene werden nach und nach umgewandelt.

## 1.1.0 – 10.11.2026

### Neu
- Anmeldung, Benutzerverwaltung mit den Rollen Administrator und Betrachter.
- Home-Assistant-Integration mit Freigabe durch einen Administrator.
- Speicherwächter: löscht bei knappem Platz das Älteste zuerst, notfalls minutenweise.
- Update über `kestrel update`, automatische Rückkehr zur alten Version bei Fehlstart.
- Versionsnummer in der Oberfläche.
- zip-Archiv vergangener Tage (in 1.2 durch H.265 ersetzt).

## 1.0.0 – 10.11.2026

### Neu
- Aufnahme des M-JPEG-Stroms von MOBOTIX-Kameras, jedes Bild unverändert mit eigenem Zeitstempel.
- Player mit variabler Bildrate, Zeitleiste und Einzelbildschritt.
- Objekterkennung auf der CPU (YOLOX) mit Ereignissen und Boxen.
- Live-Ansicht, Systemseite, Installer für Docker.
