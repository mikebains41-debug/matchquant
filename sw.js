// sw.js (MatchQuant 2) — Offline-first + safe cache versioning
const CACHE = "mq2-cache-v2";

const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./engine.js",
  "./manifest.json",

  // DATA (make sure names match your /data folder exactly)
  "./data/league.json",                 // <-- FIXED (was leagues.json)
  "./data/teams.json",
  "./data/xg_tables.json",
  "./data/h2h.json",
  "./data/aliases.json",
  "./data/cards_corners_2025_2026.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Only handle GET
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Only cache same-origin requests (prevents weird CORS issues)
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((res) => {
          // Cache successful responses
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached || new Response("Offline", { status: 503 }))
    })
  );
});
