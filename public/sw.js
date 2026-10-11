const CACHE = 'flixleo-shell-v1';
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || /\.(mp4|m3u8|ts|m4s|mpd|vtt|srt)$/.test(url.pathname)) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname === '/flixleo-logo.svg' || url.pathname === '/manifest.webmanifest') {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const response = await fetch(req).catch(() => undefined);
      if (response?.ok) cache.put(req, response.clone());
      return response || (await cache.match(req)) || Response.error();
    }));
  }
});