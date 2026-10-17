const CACHE_NAME = 'ocean-travel-2cf12494';
const CORE_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './ocean-travel-logo.png',
    './app-styles.min.css?v=af6d220b',
    './document-libraries.js?v=7c5a726d',
    './main.js?v=9e9d298b',
    './auth.js?v=625c50ce',
    './firebase-config.js?v=aab230c1',
    './utils.js?v=e25602cc',
    './state.js?v=8eca2a3d',
    './db.js?v=00aef24a',
    './ui.js?v=56ef3857',
    './tickets.js?v=e9bbd407',
    './booking.js?v=97f176ff',
    './settlement.js?v=5ea3d0fb',
    './clients.js?v=2b5fc09a',
    './reports.js?v=89d798e1',
    './search.js?v=d258792f',
    './manage.js?v=1e9c9c23',
    './history.js?v=522209bc',
    './invoice.js?v=8c3cc9bd',
    './invoice-selection.mjs?v=2d426669',
    './documents.js?v=cfee9d8d',
    './config.js?v=147a2e3d',
    './passport.js?v=5d8bc9ea',
    './passport-ocr.js?v=456777f7',
    './passport-parser.mjs?v=d0633dfa'
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

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
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

    const isSameOrigin = url.origin === self.location.origin;
    const isCodeOrDoc = isSameOrigin && (
        event.request.mode === 'navigate' ||
        /\.(?:html|m?js|css|json)$/i.test(url.pathname) ||
        url.pathname === '/'
    );

    const networkFetch = isCodeOrDoc
        ? fetch(event.request, { cache: 'no-cache' })
        : fetch(event.request);

    event.respondWith(
        networkFetch
            .then((response) => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(async () => {
                const exactMatch = await caches.match(event.request);
                if (exactMatch) return exactMatch;
                return caches.match(event.request, { ignoreSearch: true });
            })
    );
});
