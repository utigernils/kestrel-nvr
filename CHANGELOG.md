# Changelog

## 1.4.0 – 2026-11-11

### New
- Multilingual: English and German, selectable under Settings → Appearance; “Automatic” uses the browser language. Date and number formats, object names, error messages and the changelog follow the language.
- Detection model selectable under Settings → Detection: download YOLOX Nano, Tiny and S with one click, upload your own ONNX model, switch without restart, inference time shown.
- Home Assistant: events arrive instantly by push. New bus event `kestrel_event` (start, update, end), an image entity with the picture of the last event and an event entity per camera; binary sensors switch without delay.
- Every event stores a larger picture (snapshot) of its best moment.
- Optimised for phones: touch targets of at least 44 px, dialogs as bottom sheets, landscape player, no horizontal scrolling.
- Installable as an app: “Add to home screen” button under Settings → Appearance (browsers only offer this over HTTPS or localhost; otherwise instructions are shown).
- Subtle transitions when switching views and settings tabs; off with “reduce motion”.
- Kestrel theme: speed of the background gradient adjustable, down to “still”.
- English README for publishing, with screenshots; the German version is included as `README.de.md`.

### Changed
- Kestrel theme: the bottom bar is opaque and matte, without a gradient; its buttons look like all other buttons.
- The user button in the bar leads straight to Settings → Account.
- The settings tabs no longer show a scrollbar.
- The server reports errors and warnings as codes; the UI provides the text in the selected language.
- The Home Assistant integration polls only every 5 seconds (measurements); events arrive by push.

## 1.3.0 – 2026-11-11

### New
- Themes: “Kestrel” and “Levin”, each light and dark, selectable under Settings → Appearance. “Automatic” follows the operating system.
- Levin theme: plain interface with a sidebar, without animations and effects.
- The streaming core now supports three camera types: MOBOTIX (as before), generic M-JPEG cameras over HTTP and cameras with H.264/H.265 over RTSP.
- RTSP cameras are recorded without re-encoding; a low-resolution sub stream can be given for live view and detection.
- Changelog in the settings.

### Changed
- Kestrel theme reworked: white instead of coloured text, opaque cards and notices, login page with a gradient instead of the radar.
- Click sparks, gradient text and light effects on cards and buttons removed.
- “Storage lasts for” calculates JPEG cameras and RTSP cameras separately.

## 1.2.0 – 2026-11-11

### New
- Interface rebuilt in React and TypeScript.
- Events with a preview as a short image sequence.
- Player with the day's event list, keyboard shortcuts and day-by-day browsing.
- Finished hours are transcoded to H.265 in the background with the lowest priority.

### Changed
- “Storage lasts for” takes the measured ratio of H.265 to JPEG into account.
- zip archives from 1.1 are gone; existing ones are converted step by step.

## 1.1.0 – 2026-11-10

### New
- Login, user management with the roles administrator and viewer.
- Home Assistant integration with approval by an administrator.
- Storage guard: deletes the oldest first when space runs short, minute by minute if necessary.
- Update via `kestrel update`, automatic return to the old version if the new one fails to start.
- Version number in the interface.
- zip archive of past days (replaced by H.265 in 1.2).

## 1.0.0 – 2026-11-10

### New
- Recording of the M-JPEG stream of MOBOTIX cameras, every frame unchanged with its own timestamp.
- Player with variable frame rate, timeline and single-frame stepping.
- CPU object detection (YOLOX) with events and boxes.
- Live view, system page, installer for Docker.
