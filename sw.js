const CACHE_NAME = 'electrum-cache-v1';
const assets = [
  './',
  './index.html',
  './app.js',
  './config.js',
  './icon.svg'
];

// Install Service Worker & Simpan Cache
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(assets);
    })
  );
});

// Ambil data dari Cache kalau Offline
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => {
      return res || fetch(e.request);
    })
  );
});