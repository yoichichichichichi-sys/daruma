// Minimal service worker: only exists so the app is installable to the
// home screen and can register as a Web Share Target. No offline caching.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally not intercepted; the browser handles requests normally.
});
