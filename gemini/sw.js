const CACHE_NAME = 'kft-gemini-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/finance.js',
  './js/store.js',
  './js/charts.js',
  './js/app.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/hero-mesh.jpg',
  './assets/empty-vault.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // GitHub API veya canlı fiyat dosyası için daima network-first
  if (url.hostname === 'api.github.com' || url.pathname.endsWith('prices.json')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Aynı origin uygulama kabuğu: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetched = fetch(event.request)
          .then(res => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || fetched;
      })
    );
  }
});
