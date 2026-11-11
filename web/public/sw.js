/*
 * Kestrel NVR - Service Worker.
 * Puffert ausschliesslich die App-Huelle (index.html und die gebauten Dateien unter /assets/),
 * damit die installierte App sofort startet. Alles unter /api/ - Daten, Bilder, Live-Stroeme,
 * Video - wird NIE angefasst und geht immer direkt ans Netz.
 * __KESTREL_VERSION__ wird beim Bauen ersetzt; eine neue Version raeumt den alten Puffer weg.
 */
const CACHE = 'kestrel-shell-__KESTREL_VERSION__';
// Basis-Pfad (normalerweise '/', hinter einem Reverse-Proxy evtl. ein Unterpfad)
const BASE = new URL(self.registration.scope).pathname;
const SHELL = BASE;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.add(new Request(SHELL, { cache: 'reload' }))).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  const path = '/' + url.pathname.slice(BASE.length);
  if (path.startsWith('/api/') || path === '/sw.js') return;

  // Seitenaufruf: immer zuerst das Netz (so kommt eine neue Version sofort an), Puffer nur als Rueckfall.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put(SHELL, res.clone());
        return res;
      } catch {
        return (await caches.match(SHELL)) ?? Response.error();
      }
    })());
    return;
  }

  // Gebaute Dateien tragen einen Hash im Namen und aendern sich nie: zuerst aus dem Puffer.
  if (path.startsWith('/assets/')) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
  }
});
