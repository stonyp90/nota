/* Nota service worker — installable PWA + offline app shell.
   Shell (HTML/CSS/JS) is cache-first so the app opens offline (then falls back
   to its localStorage carnet). The API is network-first and never cached — the
   carnet must be fresh, and POSTs must reach the server. */
const CACHE = 'nota-shell-v1';
const SHELL = [
  '/', '/index.html', '/app.js', '/domain.js', '/styles.css',
  '/favicon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // never cache POST/PUT (offers, notary actions)
  const url = new URL(req.url);

  // API: network-first, no cache; graceful offline JSON.
  if (url.pathname.startsWith('/api')) {
    e.respondWith(
      fetch(req).catch(() =>
        new Response(JSON.stringify({ errors: [{ code: 'hors_ligne', message: 'Hors ligne.' }] }), {
          status: 503, headers: { 'content-type': 'application/json' },
        })
      )
    );
    return;
  }

  // Shell/assets: cache-first, then network (and cache it), else the app shell.
  e.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    )
  );
});
