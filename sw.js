// sw.js — one-time nuke: clears itself + forces clients to refresh
self.addEventListener("install", (e) => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // clear caches if any exist
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));

    // unregister self
    await self.registration.unregister();

    // hard refresh all clients
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clients.forEach((c) => c.navigate(c.url));
  })());
});
