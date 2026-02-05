// sw.js (DEBUG SAFE) — do not cache anything
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Always go to network (no caching)
  event.respondWith(fetch(event.request));
});
