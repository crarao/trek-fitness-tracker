// CoachBoard service worker (v2)
// - App files that never change (/_next/static, icons, fonts): served from the phone's cache first → fast reopen.
// - Pages: always from the network (never cache logged-in screens); if offline, show the cached login page.
// - Supabase and /api calls: never touched.
const CACHE = 'coachboard-v2';
const SHELL = ['/login'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  // Old cache versions (e.g. coachboard-v1, which also stored logged-in pages) are cleared here
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

const isStaticAsset = url =>
  url.pathname.startsWith('/_next/static/') ||
  /^\/icon-\d+\.png$/.test(url.pathname) ||
  url.pathname === '/favicon.ico' ||
  url.pathname === '/manifest.json' ||
  /\.(?:woff2?|ttf|otf)$/.test(url.pathname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Only our own site; never Supabase, other hosts or API routes
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Content-hashed app files and icons: cache first, fill the cache on first use
  if (isStaticAsset(url)) {
    e.respondWith(
      caches.match(req).then(cached =>
        cached ||
        fetch(req).then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
      )
    );
    return;
  }

  // Page navigations: network only; offline fallback to the cached login page
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('/login').then(r => r || Response.error()))
    );
  }
  // Everything else (data requests, prefetches): straight to the network, not cached
});
