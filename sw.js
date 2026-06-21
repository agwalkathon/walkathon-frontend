const CACHE_NAME = "agwalk-v1";
const SHELL_URLS = [
  "/agwalk/",
  "/agwalk/portal.html",
  "/agwalk/participant.html",
  "/agwalk/participant-leaderboard.html",
  "/agwalk/leaderboard.html",
  "/agwalk/index.html",
  "/agwalk/_shared.css",
  "/agwalk/icon-192.png",
  "/agwalk/icon-512.png",
  "/agwalk/favicon.png",
  "/agwalk/logo-icon.png",
  "/agwalk/logo-white.png",
  "/agwalk/logo-text-white.png"
];

const OFFLINE_URL = "/agwalk/offline.html";

// Install — cache shell
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log("[SW] Caching shell");
      return cache.addAll(SHELL_URLS);
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, fall back to cache, then offline page
self.addEventListener("fetch", event => {
  // Skip non-GET and cross-origin requests
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses for shell pages
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // For navigate requests, show offline page
          if (event.request.mode === "navigate") {
            return caches.match(OFFLINE_URL);
          }
        });
      })
  );
});

// Push notifications
self.addEventListener("push", event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "Arcgate Walkathon";
  const options = {
    body: data.body || "You have a new update.",
    icon: "/agwalk/icon-192.png",
    badge: "/agwalk/icon-192.png",
    data: { url: data.url || "/agwalk/portal.html" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click — open app
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window" }).then(list => {
      const target = event.notification.data.url;
      for (const client of list) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
