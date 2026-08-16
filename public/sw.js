const CACHE_NAME = 'musicapp-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// Precache Vite-built assets by scanning the HTML for script/link tags
// This runs once during install to ensure the app shell works offline
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache known static assets
      await cache.addAll(STATIC_ASSETS);

      // Try to find and cache the Vite entry script from index.html
      try {
        const res = await cache.match('/index.html');
        if (res) {
          const html = await res.text();
          // Extract JS and CSS file paths from the built HTML
          const matches = html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g);
          const assetUrls = [];
          for (const m of matches) {
            assetUrls.push(m[1]);
          }
          // Also extract the Vite manifest reference if present
          const manifestMatch = html.match(/manifest="([^"]+)"/);
          if (manifestMatch) assetUrls.push(manifestMatch[1]);

          if (assetUrls.length > 0) {
            await Promise.allSettled(
              assetUrls.map(url => cache.add(url).catch(() => {}))
            );
          }
        }
      } catch { /* non-critical */ }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // Never cache audio streams, downloads, or trending data: streams and
  // downloads go to IndexedDB, and trending has its own honest cache layer
  // (a cached empty/fallback trending response must never resurface offline).
  if (
    url.pathname.startsWith('/api/stream') ||
    url.pathname.startsWith('/api/download') ||
    url.pathname.includes('/trending')
  ) return;

  // API routes: network-first with cache fallback (for offline catalogue)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.ok) return response;
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets: cache-first for fast loads, network fallback
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
    })
  );
});
