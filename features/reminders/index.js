// Reminders: stored in the DB, fired by a polling scheduler, so they survive restarts.
// A reminder is either an offset before the task's due time ("offset_min", 0 = at due time) or a custom date+time.
// Tasks with a date but no time use the "default_reminder_time" setting.
//
// Delivery rules:
//  - claimed with a short lease so two ticks can never send the same reminder twice
//  - after downtime, reminders older than `catch_up_hours` are marked "expired" instead of firing
//  - an in-app notification is created once; push is retried with backoff (up to 5 attempts)
import { db } from "../../core/db.js";
import { httpError } from "../../core/router.js";
import { events } from "../../core/events.js";
import { addDays, dayIn, localToUtc, validDay, validTime } from "../../core/time.js";
import { getSetting } from "../settings/index.js";
import { createNotification } from "../notifications/index.js";
import { pushToAll } from "../push/index.js";

const clock12 = hhmm => { const [h, m] = hhmm.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

// What a notification says under the task title: "Today, 5:00 PM · My Tasks".
export function reminderBody(task, listName, today) {
  let when = "";
  if (task.due) {
    const day = task.due === today ? "Today" : task.due === addDays(today, 1) ? "Tomorrow" : task.due === addDays(today, -1) ? "Yesterday"
      : new Date(task.due + "T12:00Z").toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    when = task.due_time ? `${day}, ${clock12(task.due_time)}` : day;
  }
  return [when, listName].filter(Boolean).join(" · ");
}

const OFFSETS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880];

function computeRemindAt(spec, task) {
  const tz = getSetting("timezone");
  if (spec.custom_local) {
    const [d, t] = spec.custom_local.split("T");
    return localToUtc(d, t, tz);
  }
  if (!task.due) return null;
  const at = localToUtc(task.due, task.due_time || getSetting("default_reminder_time"), tz);
  return new Date(new Date(at).getTime() - spec.offset_min * 60_000).toISOString();
}

// Recompute remind_at for a task's reminders (after its date/time changed). Re-arms ones that already fired.
function syncTask(taskId) {
  const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(taskId);
  if (!task) return;
  const now = new Date().toISOString();
  for (const r of db.prepare("SELECT * FROM reminders WHERE task_id=?").all(taskId)) {
    const remind_at = computeRemindAt(r, task);
    if (remind_at === r.remind_at) continue;
    const rearm = r.status !== "pending" && remind_at && remind_at > now;
    db.prepare(`UPDATE reminders SET remind_at=?, status=CASE WHEN ? THEN 'pending' ELSE status END,
      attempts=CASE WHEN ? THEN 0 ELSE attempts END, notification_id=CASE WHEN ? THEN NULL ELSE notification_id END WHERE id=?`)
      .run(remind_at, +rearm, +rearm, +rearm, r.id);
  }
}

function parseSpec(s) {
  if (s?.custom_local) {
    const [d, t] = String(s.custom_local).split("T");
    if (!validDay(d) || !validTime(t)) throw httpError(400, "Bad reminder time");
    return { offset_min: null, custom_local: `${d}T${t}` };
  }
  if (OFFSETS.includes(Number(s?.offset_min)) ) return { offset_min: Number(s.offset_min), custom_local: null };
  throw httpError(400, "Bad reminder");
}

export async function tick() {
  const now = new Date();
  const nowIso = now.toISOString();
  const lease = new Date(now.getTime() + 60_000).toISOString();
  const catchUp = Number(getSetting("catch_up_hours")) * 3600_000;
  const due = db.prepare(`SELECT * FROM reminders WHERE status='pending' AND remind_at IS NOT NULL AND remind_at<=?
    AND (next_attempt_at IS NULL OR next_attempt_at<=?) AND (claimed_until IS NULL OR claimed_until<=?)
    ORDER BY remind_at LIMIT 50`).all(nowIso, nowIso, nowIso);
  for (const r of due) {
    const claim = db.prepare("UPDATE reminders SET claimed_until=? WHERE id=? AND status='pending' AND (claimed_until IS NULL OR claimed_until<=?)")
      .run(lease, r.id, nowIso);
    if (!claim.changes) continue;
    const finish = (status, extra = "") => db.prepare(`UPDATE reminders SET status=?, claimed_until=NULL${extra} WHERE id=?`).run(status, r.id);
    try {
      const task = db.prepare("SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL").get(r.task_id);
      if (!task || task.done_at) { finish("skipped"); continue; }
      if (now - new Date(r.remind_at) > catchUp) { finish("expired"); continue; }

      let nid = r.notification_id;
      const body = reminderBody(task, db.prepare("SELECT name FROM lists WHERE id=?").get(task.list_id)?.name, dayIn(getSetting("timezone")));
      if (!nid) {
        nid = createNotification({ type: "reminder", title: task.title, body, task_id: task.id });
        db.prepare("UPDATE reminders SET notification_id=? WHERE id=?").run(nid, r.id);
      }
      const res = await pushToAll({ title: task.title, body, url: `/#/task/${task.id}`, tag: `reminder-${r.id}`, task_id: task.id });
      if (!res.transient) { finish("sent", `, sent_at='${nowIso}'`); continue; }
      const attempts = r.attempts + 1;
      if (attempts >= 5) { finish("failed", ", last_error='push failed 5 times'"); continue; }
      const retry = new Date(Date.now() + 60_000 * 2 ** attempts).toISOString();
      db.prepare("UPDATE reminders SET attempts=?, next_attempt_at=?, claimed_until=NULL WHERE id=?").run(attempts, retry, r.id);
    } catch (e) {
      console.error("reminder error", r.id, e);
      db.prepare("UPDATE reminders SET claimed_until=NULL, last_error=? WHERE id=?").run(String(e.message).slice(0, 200), r.id);
    }
  }
}

export default {
  name: "reminders",
  migrations: [
    `CREATE TABLE reminders (
       id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
       offset_min INTEGER, custom_local TEXT, remind_at TEXT,
       status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
       next_attempt_at TEXT, claimed_until TEXT, notification_id INTEGER, sent_at TEXT, last_error TEXT);
     CREATE INDEX reminders_due ON reminders(status, remind_at);`,
  ],
  routes: {
    "GET /api/reminders": () => db.prepare(`SELECT r.* FROM reminders r JOIN tasks t ON t.id=r.task_id WHERE t.deleted_at IS NULL`).all(),
    // Replace a task's reminders: body.reminders = [{ offset_min } | { custom_local: "YYYY-MM-DDTHH:MM" }]
    "PUT /api/tasks/:id/reminders": ({ params, body }) => {
      const task = db.prepare("SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL").get(params.id);
      if (!task) throw httpError(404, "Task not found");
      const specs = (body?.reminders ?? []).map(parseSpec).slice(0, 6);
      const keep = new Set();
      for (const s of specs) {
        const same = db.prepare("SELECT id FROM reminders WHERE task_id=? AND offset_min IS ? AND custom_local IS ?").get(task.id, s.offset_min, s.custom_local);
        keep.add(same ? same.id : Number(db.prepare("INSERT INTO reminders(task_id,offset_min,custom_local) VALUES (?,?,?)").run(task.id, s.offset_min, s.custom_local).lastInsertRowid));
      }
      for (const r of db.prepare("SELECT id FROM reminders WHERE task_id=?").all(task.id))
        if (!keep.has(r.id)) db.prepare("DELETE FROM reminders WHERE id=?").run(r.id);
      syncTask(task.id);
      return db.prepare("SELECT * FROM reminders WHERE task_id=?").all(task.id);
    },
  },
  start() {
    events.on("task:changed", syncTask);
    events.on("task:recurred", ({ from, to }) => { // the next occurrence inherits relative reminders
      for (const r of db.prepare("SELECT * FROM reminders WHERE task_id=? AND offset_min IS NOT NULL").all(from))
        db.prepare("INSERT INTO reminders(task_id,offset_min) VALUES (?,?)").run(to, r.offset_min);
      syncTask(to);
    });
    let running = false;
    const loop = async () => { if (running) return; running = true; try { await tick(); } finally { running = false; } };
    setInterval(loop, 30_000).unref();
    loop(); // catch up right away after a restart
  },
};
