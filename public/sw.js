const cacheName = 'uptex-v3';
const shell = ['/', '/styles.css', '/app.js', '/icons.js', '/maps.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(shell)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith('uptex-') && key !== cacheName).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.match('/', { cacheName })) || Response.error()));
    return;
  }
  if (!shell.includes(url.pathname) && url.pathname !== '/api/catalog') return;
  event.respondWith(load(event.request, url.pathname));
});

async function load(request, pathname) {
  let cached;
  try {
    const response = await fetch(request);
    if (response.ok && pathname === '/api/catalog') {
      const cache = await caches.open(cacheName);
      await cache.put(pathname, response.clone()).catch((error) => {
        console.warn('No se pudo guardar el catálogo:', error.message);
      });
    }
    return response;
  } catch {
    cached = await caches.match(pathname, { cacheName });
  }
  if (!cached) return Response.error();
  if (pathname !== '/api/catalog') return cached;
  const catalog = await cached.json();
  catalog.routes = catalog.routes.map((route) => ({ ...route, trip: null }));
  return Response.json(catalog, { headers: { 'X-UPTEX-Offline': '1' } });
}
