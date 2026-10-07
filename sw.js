// Service worker: precaches every asset so the scanner works with no signal after
// the first visit.
//
// Strategy: answer from the cache immediately (never wait on a weak network at the
// gate), and refresh the cached copy in the background when online, so an update
// (e.g. the real PUBLIC_KEY in config.js) shows up on the following visit.
// Bump CACHE_VERSION whenever the file list changes or to force a clean re-download.

const CACHE_VERSION = 'v1';
const CACHE_NAME = `ceibos-scanner-${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './verify.js',
  './config.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/tweetnacl/nacl-fast.js',
  './vendor/jsqr/jsQR.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('ceibos-scanner-') && k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Navigations (any URL in scope, with or without a query) get the app shell.
      const key = request.mode === 'navigate' ? './index.html' : request;
      const cached = await cache.match(key, { ignoreSearch: true });

      const refresh = fetch(key, { cache: 'no-cache' })
        .then(response => {
          if (response.ok && response.type === 'basic') cache.put(key, response.clone());
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(refresh);
        return cached;
      }
      return (await refresh) ?? Response.error();
    })(),
  );
});
