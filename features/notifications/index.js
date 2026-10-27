// In-app notification history. Other features call createNotification(); the UI lists + marks read.
import { db } from "../../core/db.js";

export function createNotification({ type, title, body = "", task_id = null }) {
  const r = db.prepare("INSERT INTO notifications(type,title,body,task_id) VALUES (?,?,?,?)").run(type, title, body, task_id);
  return Number(r.lastInsertRowid);
}

export default {
  name: "notifications",
  migrations: [
    `CREATE TABLE notifications (
       id INTEGER PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
       task_id INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), read_at TEXT);
     CREATE INDEX notifications_created ON notifications(created_at);`,
  ],
  routes: {
    "GET /api/notifications": () => db.prepare("SELECT * FROM notifications ORDER BY id DESC LIMIT 200").all(),
    "POST /api/notifications/read": ({ body }) => {
      const now = new Date().toISOString();
      if (Array.isArray(body?.ids) && body.ids.length)
        for (const id of body.ids) db.prepare("UPDATE notifications SET read_at=? WHERE id=? AND read_at IS NULL").run(now, id);
      else db.prepare("UPDATE notifications SET read_at=? WHERE read_at IS NULL").run(now);
      return { ok: true };
    },
    "DELETE /api/notifications": () => { db.prepare("DELETE FROM notifications").run(); return { ok: true }; },
  },
  start() { // keep history bounded
    db.prepare("DELETE FROM notifications WHERE created_at < ?").run(new Date(Date.now() - 90 * 864e5).toISOString());
  },
};
