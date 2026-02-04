const CACHE = "matchquant-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./xg_tables.json",
  "./fixtures.json",
  "./h2h.json",
  "./manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : null))))
  );
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request).then(net => {
      const copy = net.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return net;
    }).catch(() => caches.match("./index.html")))
  );
});
