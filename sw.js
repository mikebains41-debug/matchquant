// sw.js — FULL REPLACE (network-first + bust old caches)
const CACHE_NAME = "matchquant-v3";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});

// Network-first for everything (so JSON updates immediately)
self.addEventListener("fetch", (event) => {
  event.respondWith((async () => {
    try {
      const res = await fetch(event.request, { cache: "no-store" });
      return res;
    } catch (e) {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      return cached || Response.error();
    }
  })());
});
