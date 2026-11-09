const CACHE_NAME = "ludo-neon-v27";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./controller.js",
  "./online.js",
  "./config.js",
  "./manifest.json",
  "./vendor/socket.io.min.js",
  "./images/icon.svg",
  "./sounds/dice.mp3",
  "./sounds/move.mp3",
  "./sounds/step.mp3",
  "./sounds/cut.mp3",
  "./sounds/win.mp3",
  "./sounds/home.mp3",
  "./sounds/bg.mp3"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(FILES_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Network-first so multiplayer updates and version fixes are never stale.
// Cross-origin requests (Socket.IO traffic, CDN assets) are left untouched.
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/socket.io/")) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request))
  );
});
