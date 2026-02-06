const CACHE_NAME = "matchquant-v2";

const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./engine.js",
  "./manifest.json",
  "./fixtures.json",
  "./h2h.json",
  "./data/xg_2025_2026.json",
  "./data/aliases.json",
  "./data/league_strength.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});
