const CACHE_NAME = 'kurionyx-shell-v3';
const APP_SHELL = [
  '/',
  '/index.html',
  '/login.html',
  '/toolkit.html',
  '/styles.css',
  '/auth.js',
  '/toolkit.js',
  '/settings.js',
  '/analysis-tools.js',
  '/pwa.js',
  '/manifest.webmanifest',
  '/icons/kurionyx-192.png',
  '/icons/kurionyx-512.png',
  '/icons/kurionyx-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => {
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('/toolkit.html');
        return Response.error();
      }))
  );
});
