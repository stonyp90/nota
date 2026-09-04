/* Nota service worker — installable PWA + offline app shell.
   Strategy:
     - HTML (navigations): network-first, so a new deploy's index.html — which
       points at freshly content-hashed asset filenames — is picked up the moment
       the user is online; falls back to the cached shell when offline.
     - Hashed assets (app.<hash>.js, styles.<hash>.css, domain.<hash>.js) and
       icons: cache-first. Safe because a content change changes the filename, so
       a stale asset can never shadow a new one.
     - API: network-first, never cached (the carnet must be fresh; POSTs must
       reach the server).
   The cache name is stamped per build, so `activate` purges every prior shell
   and returning visitors never get pinned to an old bundle. */
const CACHE = 'nota-shell-dev'; /* build.mjs stamps this per build */
const SHELL = [
  '/', '/index.html', '/app.js', '/domain.js', '/i18n.js', '/styles.css',
  '/favicon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest',
  '/manifest.en.webmanifest',
]; /* build.mjs rewrites this list with the hashed filenames */

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
  // Same origin only: the font host (rsms.me), Stripe and the signed document
  // URLs (ADR 0032: bytes go straight to the bucket) are never cached here
  // and never answered by this worker — the browser fetches them itself.
  if (url.origin !== self.location.origin) return;

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

  // HTML shell: network-first so new asset hashes are picked up online; the
  // cached shell is the offline fallback. Same-origin navigations only.
  const isHtml = req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';
  if (isHtml) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Hashed assets / icons: cache-first, then network (and cache it). A miss
  // offline is a plain failure — never the HTML shell in a stylesheet's or
  // script's clothing.
  e.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => new Response('', { status: 503, statusText: 'Hors ligne' }))
    )
  );
});
