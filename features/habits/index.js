// Habits are separate from tasks: they repeat forever, keep a log, and can have measurable weekly goals.
//  kind "check":  done or not per day (e.g. Exercise). weekly_target = times per week (optional).
//  kind "amount": log sessions with amounts (e.g. DSA, unit "h", weekly_target 14). daily_target optional.
//  days: JSON array of weekdays it is scheduled on (0 = Sunday).
// Stats (streaks, weekly progress) are computed in the browser from logs: see web/habitstats.js.
import { db } from "../../core/db.js";
import { httpError } from "../../core/router.js";
import { validDay } from "../../core/time.js";

const ser = h => ({ ...h, days: JSON.parse(h.days) });
const get = id => db.prepare("SELECT * FROM habits WHERE id=?").get(id) ?? (() => { throw httpError(404, "Habit not found"); })();
const num = (v, name) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!(n > 0) || n > 100000) throw httpError(400, `Invalid ${name}`);
  return n;
};

function fields(b) {
  const out = {};
  if ("name" in b) { out.name = String(b.name).trim().slice(0, 80); if (!out.name) throw httpError(400, "Name required"); }
  if ("kind" in b) { if (!["check", "amount"].includes(b.kind)) throw httpError(400, "Bad kind"); out.kind = b.kind; }
  if ("days" in b) {
    const days = [...new Set((b.days ?? []).map(Number).filter(d => d >= 0 && d <= 6))].sort();
    if (!days.length) throw httpError(400, "Pick at least one day");
    out.days = JSON.stringify(days);
  }
  if ("weekly_target" in b) out.weekly_target = num(b.weekly_target, "weekly target");
  if ("daily_target" in b) out.daily_target = num(b.daily_target, "daily target");
  if ("unit" in b) out.unit = String(b.unit ?? "").trim().slice(0, 12);
  if ("archived" in b) out.archived_at = b.archived ? new Date().toISOString() : null;
  return out;
}

export default {
  name: "habits",
  migrations: [
    `CREATE TABLE habits (
       id INTEGER PRIMARY KEY, name TEXT NOT NULL,
       kind TEXT NOT NULL DEFAULT 'check' CHECK (kind IN ('check','amount')),
       days TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]', weekly_target REAL, daily_target REAL,
       unit TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0,
       archived_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
     CREATE TABLE habit_logs (
       id INTEGER PRIMARY KEY, habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
       day TEXT NOT NULL, amount REAL NOT NULL DEFAULT 1, note TEXT NOT NULL DEFAULT '',
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
     CREATE INDEX habit_logs_habit_day ON habit_logs(habit_id, day);`,
  ],
  routes: {
    // logs for the last 400 days is plenty for streaks and the progress page
    "GET /api/habits": () => ({
      habits: db.prepare("SELECT * FROM habits ORDER BY position, id").all().map(ser),
      logs: db.prepare("SELECT * FROM habit_logs WHERE day >= date('now','-400 day') ORDER BY day, id").all(),
    }),
    "POST /api/habits": ({ body }) => {
      const f = fields({ kind: "check", ...body });
      if (!f.name) throw httpError(400, "Name required");
      const keys = Object.keys(f);
      const r = db.prepare(`INSERT INTO habits(${keys}) VALUES (${keys.map(() => "?")})`).run(...keys.map(k => f[k]));
      return ser(get(r.lastInsertRowid));
    },
    "PATCH /api/habits/:id": ({ params, body }) => {
      const h = get(params.id);
      const f = fields(body ?? {});
      const keys = Object.keys(f);
      if (keys.length) db.prepare(`UPDATE habits SET ${keys.map(k => k + "=?")} WHERE id=?`).run(...keys.map(k => f[k]), h.id);
      return ser(get(h.id));
    },
    "DELETE /api/habits/:id": ({ params }) => { db.prepare("DELETE FROM habits WHERE id=?").run(params.id); return { ok: true }; },

    "POST /api/habits/:id/logs": ({ params, body }) => {
      const h = get(params.id);
      if (!validDay(body?.day)) throw httpError(400, "Bad day");
      const amount = h.kind === "check" ? 1 : num(body?.amount, "amount");
      if (!amount) throw httpError(400, "Amount required");
      const r = db.prepare("INSERT INTO habit_logs(habit_id,day,amount,note) VALUES (?,?,?,?)").run(h.id, body.day, amount, String(body?.note ?? "").slice(0, 300));
      return db.prepare("SELECT * FROM habit_logs WHERE id=?").get(r.lastInsertRowid);
    },
    // Check-habits: tap to mark a day done, tap again to undo. Returns the day's logs after the change.
    "POST /api/habits/:id/toggle": ({ params, body }) => {
      const h = get(params.id);
      if (!validDay(body?.day)) throw httpError(400, "Bad day");
      const existing = db.prepare("SELECT id FROM habit_logs WHERE habit_id=? AND day=?").all(h.id, body.day);
      if (existing.length) db.prepare("DELETE FROM habit_logs WHERE habit_id=? AND day=?").run(h.id, body.day);
      else db.prepare("INSERT INTO habit_logs(habit_id,day,amount) VALUES (?,?,1)").run(h.id, body.day);
      return db.prepare("SELECT * FROM habit_logs WHERE habit_id=? AND day=?").all(h.id, body.day);
    },
    "DELETE /api/habit-logs/:id": ({ params }) => { db.prepare("DELETE FROM habit_logs WHERE id=?").run(params.id); return { ok: true }; },
  },
};
