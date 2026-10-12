// Офлайн-кэш: приложение открывается без интернета.
const CACHE = "kooly-v20";
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "connect.js",
  "edupage.js",
  "stuudium.js",
  "progress.js",
  "menu.js",
  "calendar.js",
  "app.js",
  "fonts/mulish-cyrillic.woff2",
  "fonts/mulish-latin.woff2",
  "fonts/mulish-latin-ext.woff2",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Сначала сеть (чтобы обновления доходили сразу), без сети — из кэша.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Кэшируем только файлы самого Kooly: ответы Google, посредника и API не сохраняем.
  if (e.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }) // всегда сверяемся с сервером, чтобы файлы разных версий не смешивались
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// Клик по уведомлению: открыть Kooly на нужной вкладке (например, «Homme» для ранца).
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const tab = e.notification.data?.tab || "now";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      if (list[0]) {
        list[0].postMessage({ tab });
        return list[0].focus();
      }
      return self.clients.openWindow(`./#${tab}`);
    })
  );
});
