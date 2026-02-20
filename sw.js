// sw.js — disabled to prevent stale caching issues on GitHub Pages
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => self.registration.unregister());
