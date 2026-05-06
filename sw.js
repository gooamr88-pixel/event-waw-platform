/* ===================================
   EVENT WAW - Service Worker
   Network-first for API calls and JS modules,
   cache-first for CSS/images/fonts.
   =================================== */

// M-7: Bump version on every deploy to purge stale caches.
// The activate handler below auto-deletes any cache !== CACHE_NAME.
const CACHE_NAME = 'event-waw-v2';
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

// ── Activate: clean ALL old caches (any key !== current CACHE_NAME) ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => {
            console.log('[SW] Purging old cache:', k);
            return caches.delete(k);
          })
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

  // JS modules: network-first (prevents stale code after deploys)
  if (isJsModule(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Other static assets (CSS, images, fonts): cache-first with network fallback
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

function isJsModule(url) {
  return url.pathname.endsWith('.js');
}

function isStaticAsset(url) {
  const ext = url.pathname.split('.').pop()?.toLowerCase();
  return ['css', 'svg', 'png', 'jpg', 'jpeg', 'webp', 'woff', 'woff2', 'ico'].includes(ext);
}
