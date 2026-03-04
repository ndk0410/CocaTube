const CACHE_NAME = 'musicflow-pwa-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/api.js',
  '/player.js',
  '/firebase-config.js'
];

// Install event: cache core assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then((cache) => cache.addAll(ASSETS_TO_CACHE))
        .then(() => self.skipWaiting())
    );
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            }));
        })
        .then(() => self.clients.claim())
    );
});

// Fetch event: network first, fallback to cache for HTML/JS/CSS API requests are bypassed
self.addEventListener('fetch', (event) => {
    // Only intercept local static files, ignore Firebase or YouTube API cross-origin requests
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }

    event.respondWith(
        fetch(event.request)
        .catch(() => caches.match(event.request))
    );
});
