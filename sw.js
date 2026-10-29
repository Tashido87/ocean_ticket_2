const CACHE_NAME = 'ocean-travel-667509db';
const CORE_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './ocean-travel-logo.png',
    './app-styles.min.css?v=70c6c0f7',
    './dashboard-exact.css?v=10',
    './settle-exact.css?v=2',
    './hotel-exact.css?v=1',
    './search-exact.css?v=1',
    './vendor/datepicker.min.css',
    './vendor/datepicker-full.min.js',
    './vendor/chart.min.js',
    './document-libraries.js?v=7c5a726d',
    './main.js?v=bdb064d3',
    './dashboard.js?v=c8baa4fe',
    './auth.js?v=625c50ce',
    './firebase-config.js?v=aab230c1',
    './utils.js?v=83eec376',
    './state.js?v=24a8744d',
    './db.js?v=944a0ed0',
    './ui.js?v=ee8df8bb',
    './tickets.js?v=f2098800',
    './booking.js?v=f81a1350',
    './settlement.js?v=b67e0018',
    './clients.js?v=46be8017',
    './reports.js?v=a96e72e7',
    './search.js?v=e0afbd4a',
    './manage.js?v=0fff7338',
    './history.js?v=e9920af2',
    './hotel.js?v=1c18b49d',
    './agoda-hotel-converter.js?v=8d8c81ec',
    './airasia-converter.js?v=89192a13',
    './invoice.js?v=8c3cc9bd',
    './invoice-selection.mjs?v=2d426669',
    './documents.js?v=cfee9d8d',
    './config.js?v=147a2e3d',
    './passport.js?v=5d8bc9ea',
    './passport-ocr.js?v=456777f7',
    './passport-parser.mjs?v=d0633dfa',
    './china-airlines-converter.js?v=80f8de58',
    './china-airlines-parser.mjs?v=569d8f51'
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
    let url;
    try {
        url = new URL(event.request.url);
    } catch {
        return;
    }

    // Only handle standard HTTP/HTTPS schemes (ignore chrome-extension:, data:, etc.)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

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

    // Strategy A: Fast Stale-While-Revalidate for HTML Navigation
    // Instant boot from cache on reload, with background update
    if (event.request.mode === 'navigate') {
        event.respondWith(
            caches.match('./index.html').then((cachedHtml) => {
                const networkFetch = fetch(event.request, { cache: 'no-cache' })
                    .then((response) => {
                        if (response && response.status === 200) {
                            const clone = response.clone();
                            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone)).catch(() => {});
                        }
                        return response;
                    })
                    .catch(() => cachedHtml);

                return cachedHtml || networkFetch;
            })
        );
        return;
    }

    // Strategy B: Cache-First for versioned static assets & vendor files
    const isCacheFirstAsset = isSameOrigin && (
        url.search.includes('v=') ||
        url.pathname.includes('/vendor/') ||
        url.pathname.endsWith('.png') ||
        url.pathname.endsWith('.woff2') ||
        url.pathname.endsWith('.json')
    );

    if (isCacheFirstAsset) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) return cachedResponse;
                return fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                        const clone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
                    }
                    return networkResponse;
                });
            })
        );
        return;
    }

    // Strategy C: Network-First with cache fallback for everything else
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response && response.status === 200 && response.type === 'basic' && isSameOrigin) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
                }
                return response;
            })
            .catch(async () => {
                const exactMatch = await caches.match(event.request);
                if (exactMatch) return exactMatch;
                const fuzzyMatch = await caches.match(event.request, { ignoreSearch: true });
                if (fuzzyMatch) return fuzzyMatch;
                return new Response('Network error and asset not found in cache', {
                    status: 504,
                    statusText: 'Gateway Timeout',
                    headers: { 'Content-Type': 'text/plain' }
                });
            })
    );
});
