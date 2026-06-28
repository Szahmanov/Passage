/* Passage by StaGove — service worker.
   Caches the app shell so Passage launches offline like a real app. The agent's
   analysis calls (/api/groq) are NEVER cached — they always go to the network. */

const VERSION = "passage-v1";
const SHELL = "passage-shell-" + VERSION;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./data/pathway-rules.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/favicon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never touch POSTs to /api/groq

  const url = new URL(req.url);

  // Never serve API responses from cache.
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/.netlify/")) return;

  // App navigations: serve cached shell, fall back to network.
  if (req.mode === "navigate") {
    event.respondWith(caches.match("./index.html").then((c) => c || fetch(req)));
    return;
  }

  // Same-origin static assets: cache-first, then fill the cache.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => cached)
      )
    );
    return;
  }

  // Cross-origin (e.g. fonts): stale-while-revalidate.
  event.respondWith(
    caches.open(SHELL).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
