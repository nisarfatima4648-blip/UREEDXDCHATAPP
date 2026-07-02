// ============================================================================
// UREEDXD Service Worker
// Handles caching for offline support + PWA installability
// ============================================================================

const CACHE_VERSION = 'ureedxd-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/ureedxd-logo.png',
];

// ─── Install: pre-cache static assets ───────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {}) // Don't fail install if some assets are missing
  );
  self.skipWaiting();
});

// ─── Activate: clean up old caches ───────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      ))
  );
  self.clients.claim();
});

// ─── Fetch: caching strategies ──────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests (POST, PUT, etc.) — always go to network
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip cross-origin requests (socket.io, Supabase, etc.)
  if (url.origin !== self.location.origin) return;

  // Skip API routes — always fetch fresh
  if (url.pathname.startsWith('/api/')) return;

  // Skip Next.js HMR/dev routes
  if (url.pathname.startsWith('/_next/webpack-hmr')) return;

  // ─── Strategy 1: Cache-first for static assets ────────────────────────
  if (
    url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot)$/) ||
    url.pathname.startsWith('/_next/static/')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return cached || fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // ─── Strategy 2: Network-first for pages (with cache fallback) ────────
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache successful responses
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        // Network failed — try cache, then fallback to home page
        return caches.match(request).then((cached) => {
          return cached || caches.match('/');
        });
      })
  );
});

// ─── Message: allow page to trigger skipWaiting ──────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
