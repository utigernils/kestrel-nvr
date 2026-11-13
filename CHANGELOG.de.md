# Changelog

## 1.4.5 – 13.11.2026

### Neu
- Erkennung: Modelle mit End-to-End-Ausgabe (`[1, 300, 6]`, z. B. YOLO26) werden unterstützt. YOLO26n und YOLO26s liegen dem Paket bei und sind unter Einstellungen → Erkennung wählbar (Lizenz: AGPL-3.0, siehe `models/README.md`).
- RTSP-Kameras: Das Live-Bild wird nur noch dekodiert, solange es gebraucht wird – wenn die Erkennung für die Kamera an ist oder jemand zusieht. Sonst wird gar nichts dekodiert.

### Behoben
- Schnelle Wiedergabe (4× bis 16×) bleibt bei langsameren Verbindungen nicht mehr stehen. Der Player lädt jetzt mit Vorlauf, passt die Zahl der Bilder an die gemessene Ladezeit an und wartet kurz, statt den Bildern davonzulaufen.

- RTSP-Aufnahmen, in denen zwei Bilder denselben Zeitstempel tragen, ließen sich nicht zum Ansehen dekodieren; das geht jetzt.

### Geändert
- Video-Minuten (H.265 und RTSP) sind schon während des Dekodierens ansehbar: Das erste Bild erscheint nach Sekundenbruchteilen statt erst nach der ganzen Minute. Die nächste Minute wird im Voraus vorbereitet.
- Die Umkodierung nach H.265 behält den vollen Wertebereich der JPEGs (0–255), statt in den Video-Bereich und zurück zu rechnen. Gemessen: rund 2 dB bessere Qualität bei gleicher Dateigröße. Neue Minuten werden bei gleicher Qualitätsstufe etwa 10–15 % größer; vorhandene Aufnahmen bleiben, wie sie sind.
- RTSP-Kameras: Aufnahme und Live-Bild laufen in getrennten Prozessen, ein hängender Zuschauer kann die Aufnahme nie bremsen. Live-Bild und Erkennung sind höchstens 1920 px breit, zum Ansehen dekodierte Bilder höchstens 2560 px.
- Halb geschriebene Videos eines abgebrochenen Umkodierlaufs werden beim Start entfernt.

### Entfernt
- Unterstützung für zip-Archive aus Version 1.1 und die Übernahme der Einstellungen aus 1.1. Wer noch 1.1 nutzt, muss zuerst auf 1.4.0 aktualisieren.

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
