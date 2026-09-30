// Service worker: makes the Stitching view work offline (and installable with "Add to Home screen").
// Network-first: while online every request goes to the network, so updates arrive right away and the app is never
// served stale code (the confusion the no-cache dev server exists for); the cache is only the offline fallback.
// Bump CACHE when the precache list changes.
const CACHE = 'mandel-stitch-v1';
const PRECACHE = [
  'work.html', 'work.css', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/work.js', 'js/stitch.js', 'js/dmc.js', 'js/pirkka.js', 'js/rauma.js', 'js/selector.js', 'js/guides.js',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || Promise.reject(new Error('offline')))),
  );
});
