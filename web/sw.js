// Service worker: makes the app installable, keeps it usable offline (last-seen data), and shows push notifications.
const CACHE = "daymark-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

// Network first (always fresh when online); fall back to the last copy when offline.
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const url = new URL(req.url);
  if (/^\/api\/(session|push|export|backups)/.test(url.pathname)) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(async () => (await caches.match(req)) || (req.mode === "navigate" ? caches.match("/") : Response.error())));
});

self.addEventListener("push", e => {
  let data = {};
  try { data = e.data.json(); } catch { data = { title: "Daymark", body: e.data?.text() || "" }; }
  e.waitUntil(self.registration.showNotification(data.title || "Daymark", {
    body: data.body || "", tag: data.tag, icon: "/icon.svg", badge: "/icon.svg", data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async list => {
    const win = list.find(c => new URL(c.url).origin === location.origin);
    if (win) { await win.focus(); return win.navigate(url); }
    return self.clients.openWindow(url);
  }));
});
