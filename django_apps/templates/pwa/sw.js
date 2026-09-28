{% load static %}// Service worker for Tedis Tools PWA.
// This file is rendered by Django so cache version + asset URLs stay in sync.
const CACHE_VERSION = 'v{{ cache_version }}';
const CACHE_NAME = 'tedis-tools-' + CACHE_VERSION;
const OFFLINE_URL = '{{ offline_url }}';

// App shell: precached on install so the app is installable and works offline.
const PRECACHE_URLS = [
  '/',
  OFFLINE_URL,
  '{% static "pwa/icons/icon.svg" %}',
  '{% static "pwa/icons/icon-192.png" %}',
  '{% static "pwa/icons/icon-512.png" %}',
  '{% static "pwa/icons/icon-maskable-512.png" %}',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css'
];

// Paths we never want the service worker to serve from cache (auth, APIs, admin).
const BYPASS_PATHS = ['/admin', '/login', '/logout', '/oauth', '/accounts'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith('tedis-tools-') && k !== CACHE_NAME)
        .map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GET requests.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (BYPASS_PATHS.some((p) => url.pathname.startsWith(p))) return;

  // Navigations: network-first so pages always render fresh data
  // (e.g. after a POST-redirect-GET). Cache the response for offline
  // use; fall back to the cached copy, then the offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Navigation requests have redirect mode 'manual', so a
          // redirecting response surfaces as 'opaqueredirect'
          // (status 0, possibly no URL). Hand it back untouched —
          // the browser follows it as a new navigation that
          // re-enters this handler at the final URL.
          if (res.type === 'opaqueredirect') {
            return res;
          }
          // Don't cache failures or pages that ended on a bypassed
          // path (e.g. session expiry → login). Cache under the
          // final URL when fetch() followed redirects internally.
          const finalPath = new URL(res.url || req.url).pathname;
          if (
            res.ok &&
            !BYPASS_PATHS.some((p) => finalPath.startsWith(p))
          ) {
            const copy = res.clone();
            const key = res.url || req;
            caches.open(CACHE_NAME).then((c) => c.put(key, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then(
            (cached) => cached || caches.match(OFFLINE_URL)
          )
        )
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  if (url.pathname.startsWith('{{ static_url }}')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetching = fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        }).catch(() => cached);
        return cached || fetching;
      })
    );
  }
});

// Web Push: show the notification payload pushed by the server
// (currently spending-limit alerts from /finance/).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Tedis Tools', {
      body: data.body || '',
      icon: '{% static "pwa/icons/icon-192.png" %}',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(
      (event.notification.data && event.notification.data.url) || '/'
    )
  );
});
