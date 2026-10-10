const CACHE_NAME = 'ocean-travel-v39';
const CORE_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './ocean-travel-logo.png',
    './app-styles.min.css?v=1',
    './glass-start.js?v=1',
    './document-libraries.js',
    './main.js?v=107',
    './utils.js',
    './state.js',
    './db.js',
    './ui.js',
    './tickets.js?v=10',
    './booking.js',
    './settlement.js',
    './clients.js',
    './reports.js',
    './search.js?v=26'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(CORE_ASSETS).catch((err) => {
                console.warn('PWA precache warning:', err);
            });
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);

    // Skip real-time Firestore sync and auth tokens from service worker cache
    if (
        url.origin.includes('firestore.googleapis.com') ||
        url.origin.includes('firebase') ||
        url.pathname.includes('/.netlify/') ||
        url.origin.includes('identitytoolkit') ||
        url.origin.includes('securetoken')
    ) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
