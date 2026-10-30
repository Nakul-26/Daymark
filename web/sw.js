// Service worker: makes the app installable, keeps it usable offline (last-seen data), and shows push notifications.
const CACHE = "daymark-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

// Network first (always fresh when online); fall back to the last copy when offline.
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const url = new URL(req.url);
  if (/^\/api\/(session|push|export|backups)/.test(url.pathname)) return;
  // cache: "reload" skips the browser HTTP cache (Cloudflare can force max-age on static files)
  e.respondWith(fetch(req, { cache: "reload" }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(async () => (await caches.match(req)) || (req.mode === "navigate" ? caches.match("/") : Response.error())));
});

self.addEventListener("push", e => {
  let data = {};
  try { data = e.data.json(); } catch { data = { title: "Daymark", body: e.data?.text() || "You have a reminder" }; }
  e.waitUntil(self.registration.showNotification(data.title || "Daymark", {
    body: data.body || "", tag: data.tag, renotify: !!data.tag, // a newer notification with the same tag still buzzes icon: "/icon-192.png", badge: "/badge-96.png", timestamp: Date.now(),
    data: { url: data.url || "/", taskId: data.task_id || null },
    ...(data.task_id && { actions: [{ action: "done", title: "Mark done" }, { action: "reschedule", title: "Reschedule" }] }),
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  let { url = "/", taskId } = e.notification.data || {};
  if (e.action === "reschedule" && taskId) url = `/#/alarm/${taskId}`; // opens the "remind me again" popup
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (e.action === "done" && taskId) { // finish the task without opening the app
      try {
        const res = await fetch(`/api/tasks/${taskId}/complete`, { method: "POST", headers: { "X-Requested-With": "daymark", "Content-Type": "application/json" }, body: "{}" });
        if (res.ok) { wins.forEach(c => c.postMessage({ type: "tasks-changed" })); return; }
      } catch { /* offline or signed out: open the app instead */ }
    }
    const win = wins.find(c => new URL(c.url).origin === location.origin);
    if (win) { await win.focus(); return win.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
