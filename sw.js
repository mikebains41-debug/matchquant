const CACHE = "mq2-cache-v2";

const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./engine.js",
  "./manifest.json",
  "./data/xg_tables.json",
  "./data/h2h.json",
  "./data/aliases.json",
  "./data/cards_corners_2025_2026.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (event.request.method === "GET" && res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
