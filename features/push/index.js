// Web Push (VAPID). Keys are generated on first run and kept in the settings table (inside data/).
// pushToAll() returns { sent, transient }: transient=true means a retry might succeed later.
import webpush from "web-push";
import { db } from "../../core/db.js";
import { httpError } from "../../core/router.js";
import { getSetting, setSetting } from "../settings/index.js";

let ready = false;
function init() {
  if (ready) return;
  let pub = getSetting("vapid_public"), priv = getSetting("vapid_private");
  if (!pub || !priv) {
    ({ publicKey: pub, privateKey: priv } = webpush.generateVAPIDKeys());
    setSetting("vapid_public", pub); setSetting("vapid_private", priv);
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@localhost.invalid", pub, priv);
  ready = true;
}

export async function pushToAll(payload) {
  init();
  const subs = db.prepare("SELECT * FROM push_subscriptions WHERE revoked_at IS NULL").all();
  let sent = 0, transient = false;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: "high" }); // "high" so Android doesn't hold it back while the phone is dozing
      sent++;
      db.prepare("UPDATE push_subscriptions SET last_ok_at=? WHERE id=?").run(new Date().toISOString(), s.id);
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) // subscription is gone for good
        db.prepare("UPDATE push_subscriptions SET revoked_at=? WHERE id=?").run(new Date().toISOString(), s.id);
      else { transient = true; console.warn("push failed", e.statusCode || e.message); }
    }
  }
  return { sent, transient };
}

export default {
  name: "push",
  migrations: [
    `CREATE TABLE push_subscriptions (
       id INTEGER PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
       label TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       last_ok_at TEXT, revoked_at TEXT);`,
  ],
  routes: {
    "GET /api/push/key": () => { init(); return { key: getSetting("vapid_public") }; },
    "GET /api/push/subscriptions": () =>
      db.prepare("SELECT id, endpoint, label, created_at, last_ok_at FROM push_subscriptions WHERE revoked_at IS NULL").all(),
    "POST /api/push/subscribe": ({ body }) => {
      const s = body?.subscription;
      if (!s?.endpoint || !s.keys?.p256dh || !s.keys?.auth) throw httpError(400, "Bad subscription");
      db.prepare(`INSERT INTO push_subscriptions(endpoint,p256dh,auth,label) VALUES (?,?,?,?)
        ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, label=excluded.label, revoked_at=NULL`)
        .run(s.endpoint, s.keys.p256dh, s.keys.auth, String(body.label ?? "").slice(0, 80));
      return { ok: true };
    },
    "POST /api/push/unsubscribe": ({ body }) => {
      db.prepare("UPDATE push_subscriptions SET revoked_at=? WHERE endpoint=? OR id=?")
        .run(new Date().toISOString(), String(body?.endpoint ?? ""), body?.id ?? -1);
      return { ok: true };
    },
    "POST /api/push/test": async () => {
      const r = await pushToAll({ title: "Notifications are on ✓", body: "Daymark can now remind you of your tasks on this device.", url: "/#/notifications" });
      if (!r.sent) throw httpError(400, "No device received it. Enable notifications on a device first.");
      return r;
    },
  },
};
