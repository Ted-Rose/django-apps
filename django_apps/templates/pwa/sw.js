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

  // Navigations: cache-first for instant loading, update cache in background.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(req).then((cached) => {
        // Return cached version immediately for instant load
        const fetchPromise = fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
            return res;
          })
          .catch(() => cached || caches.match(OFFLINE_URL));
        
        // If we have a cached version, return it immediately
        // Otherwise wait for network
        return cached || fetchPromise;
      })
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
