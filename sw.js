/* ===================================
   EVENT WAW - Service Worker
   Network-first for API calls, cache-first for static assets
   =================================== */

const CACHE_NAME = 'event-waw-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/events.html',
  '/login.html',
  '/register.html',
  '/css/styles.css',
  '/css/theme.css',
  '/css/landing-eveenty.css',
  '/css/light-theme.css',
  '/css/eveenty-auth.css',
  '/css/events-page.css',
  '/images/favicon.svg',
  '/images/logo.svg',
  '/images/logo.png',
  '/manifest.json',
];

// ── Install: pre-cache critical static assets ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache partially failed:', err);
      });
    })
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch strategy ──
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip Supabase API calls (always network-only)
  if (url.hostname.includes('supabase')) return;

  // Skip Google Maps API
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) return;

  // Skip Chrome extensions
  if (url.protocol === 'chrome-extension:') return;

  // Static assets: cache-first with network fallback
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      }).catch(() => {
        // Offline fallback for navigation
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      })
    );
    return;
  }

  // HTML pages: network-first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }
});

function isStaticAsset(url) {
  const ext = url.pathname.split('.').pop()?.toLowerCase();
  return ['css', 'js', 'svg', 'png', 'jpg', 'jpeg', 'webp', 'woff', 'woff2', 'ico'].includes(ext);
}
