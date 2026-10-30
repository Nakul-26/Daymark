// Time tracking: entries (activity + start/end), at most one running timer, and an hourly "what did you do?" prompt.
// An entry is "what actually happened"; it can link to a task but is a different thing from the task's deadline or reminders.
// source: "timer" (start/stop), "manual" (added by hand) or "hourly" (answer to the hourly prompt).
import { db } from "../../core/db.js";
import { httpError } from "../../core/router.js";
import { dayIn, timeIn, localToUtc } from "../../core/time.js";
import { getSetting, setSetting } from "../settings/index.js";
import { pushToAll } from "../push/index.js";
import { createNotification } from "../notifications/index.js";

const HOUR = 3600_000, KEEP_DAYS = 60;
const NUDGE_AFTER = 4 * HOUR, AUTO_STOP_AFTER = 12 * HOUR; // a timer someone forgot to stop

const snapshot = () => {
  const since = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString();
  const entries = db.prepare("SELECT * FROM time_entries WHERE start_at>=? OR end_at IS NULL ORDER BY start_at DESC").all(since);
  return { entries, running: entries.find(e => !e.end_at) ?? null };
};

const activityOf = v => {
  const a = String(v ?? "").trim().replace(/\s+/g, " ");
  if (!a || a.length > 120) throw httpError(400, "Activity must be 1-120 characters");
  return a;
};
const iso = (v, what) => {
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) throw httpError(400, `Bad ${what}`);
  return new Date(t).toISOString();
};
const taskIdOf = v => {
  if (v == null || v === "") return null;
  if (!db.prepare("SELECT 1 FROM tasks WHERE id=? AND deleted_at IS NULL").get(v)) throw httpError(404, "Task not found");
  return Number(v);
};
const stopRunning = (at = new Date().toISOString()) =>
  db.prepare("UPDATE time_entries SET end_at=? WHERE end_at IS NULL").run(at);
const checkRange = (start, end) => {
  if (new Date(end) <= new Date(start)) throw httpError(400, "End must be after start");
  if (new Date(end) - new Date(start) > 24 * HOUR) throw httpError(400, "An entry can't be longer than 24 hours");
};

// ms of [from,to] already covered by entries (a running timer counts until `now`)
export function covered(from, to, now = Date.now()) {
  let sum = 0;
  for (const e of db.prepare("SELECT start_at, end_at FROM time_entries WHERE start_at<? AND (end_at IS NULL OR end_at>?)").all(new Date(to).toISOString(), new Date(from).toISOString())) {
    const s = Math.max(new Date(e.start_at).getTime(), from), f = Math.min(e.end_at ? new Date(e.end_at).getTime() : now, to);
    if (f > s) sum += f - s;
  }
  return sum;
}

// The parts of [from,to] (ms) that no entry covers yet. A running timer counts up to `now`.
export function uncovered(from, to, now = Date.now()) {
  const busy = db.prepare("SELECT start_at, end_at FROM time_entries WHERE start_at<? AND (end_at IS NULL OR end_at>?) ORDER BY start_at")
    .all(new Date(to).toISOString(), new Date(from).toISOString())
    .map(e => [Math.max(new Date(e.start_at).getTime(), from), Math.min(e.end_at ? new Date(e.end_at).getTime() : now, to)]).filter(([s, f]) => f > s);
  const gaps = []; let at = from;
  for (const [s, f] of busy) { if (s > at) gaps.push([at, s]); at = Math.max(at, f); }
  if (at < to) gaps.push([at, to]);
  return gaps.filter(([s, f]) => f - s >= 60_000);
}

// Every minute: remind about a timer that has run a long time, and stop it if it clearly was forgotten.
export async function checkForgottenTimer(now = Date.now()) {
  const run = db.prepare("SELECT * FROM time_entries WHERE end_at IS NULL").get();
  if (!run) return null;
  const age = now - new Date(run.start_at).getTime();
  if (age >= AUTO_STOP_AFTER) {
    db.prepare("UPDATE time_entries SET end_at=? WHERE id=?").run(new Date(new Date(run.start_at).getTime() + AUTO_STOP_AFTER).toISOString(), run.id);
    const body = `Stopped after ${AUTO_STOP_AFTER / HOUR} hours. Edit the entry on the Time page if that's wrong.`;
    createNotification({ type: "time", title: `Timer stopped: ${run.activity}`, body });
    await pushToAll({ title: `Timer stopped: ${run.activity}`, body, url: "/#/time", tag: "time-forgotten" });
    return "stopped";
  }
  if (age >= NUDGE_AFTER && getSetting("time_nudged") !== String(run.id)) {
    setSetting("time_nudged", run.id); // once per timer
    const body = `Running for ${Math.floor(age / HOUR)} hours. Tap to stop or keep going.`;
    createNotification({ type: "time", title: `Still tracking ${run.activity}?`, body });
    await pushToAll({ title: `Still tracking ${run.activity}?`, body, url: "/#/time", tag: "time-forgotten" });
    return "nudged";
  }
  return null;
}

// Just after each full hour inside the window, ask about the hour that ended (unless it's mostly logged already).
export async function maybeAskAboutHour(now = new Date()) {
  if (getSetting("time_prompt") !== "on") return false;
  const tz = getSetting("timezone"), day = dayIn(tz, now), [hh, mm] = timeIn(tz, now).split(":").map(Number);
  if (mm >= 10 || hh === 0) return false;
  const from = `${String(hh - 1).padStart(2, "0")}:00`, to = `${String(hh).padStart(2, "0")}:00`;
  if (from < getSetting("time_prompt_from") || to > getSetting("time_prompt_to")) return false;
  const end = new Date(localToUtc(day, to, tz)).getTime(), start = end - HOUR;
  if (getSetting("time_prompt_last") === String(end)) return false;
  setSetting("time_prompt_last", end); // set first: never ask twice for the same hour
  if (covered(start, end, now.getTime()) >= 0.5 * HOUR) return false;
  const label = h => new Date(`2000-01-01T${h}:00Z`).toLocaleTimeString("en", { hour: "numeric", timeZone: "UTC" });
  await pushToAll({ title: `What did you do ${label(from)}–${label(to)}?`, body: "Tap to log it", url: `/#/hour/${start}`, tag: "time-prompt" });
  return true;
}

export default {
  name: "time",
  migrations: [
    `CREATE TABLE time_entries (
       id INTEGER PRIMARY KEY, activity TEXT NOT NULL, task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
       start_at TEXT NOT NULL, end_at TEXT, source TEXT NOT NULL DEFAULT 'timer',
       created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
     CREATE INDEX time_entries_start ON time_entries(start_at);`,
  ],
  routes: {
    "GET /api/time": () => snapshot(),
    // Start a timer (stops the running one first)
    "POST /api/time/start": ({ body }) => {
      const activity = activityOf(body?.activity), task_id = taskIdOf(body?.task_id), now = new Date().toISOString();
      stopRunning(now);
      db.prepare("INSERT INTO time_entries(activity,task_id,start_at,source) VALUES (?,?,?,'timer')").run(activity, task_id, now);
      return snapshot();
    },
    "POST /api/time/stop": () => { stopRunning(); return snapshot(); },
    // Add a finished entry by hand
    "POST /api/time": ({ body }) => {
      const start = iso(body?.start_at, "start"), end = iso(body?.end_at, "end");
      checkRange(start, end);
      db.prepare("INSERT INTO time_entries(activity,task_id,start_at,end_at,source) VALUES (?,?,?,?,'manual')").run(activityOf(body?.activity), taskIdOf(body?.task_id), start, end);
      return snapshot();
    },
    // Answer to the hourly prompt: body = { hour_start: ms or ISO, activity }. Replaces an earlier answer for that hour.
    "POST /api/time/hour": ({ body }) => {
      const t = Number.isFinite(Number(body?.hour_start)) ? Number(body.hour_start) : new Date(body?.hour_start).getTime();
      if (!Number.isFinite(t) || t > Date.now()) throw httpError(400, "Bad hour");
      const start = new Date(t).toISOString(), end = new Date(t + HOUR).toISOString();
      const activity = activityOf(body?.activity), task_id = taskIdOf(body?.task_id);
      db.prepare("DELETE FROM time_entries WHERE source='hourly' AND start_at>=? AND start_at<?").run(start, end); // replaces an earlier answer
      // only the part of the hour nothing else covers, so a timer or manual entry isn't counted twice
      for (const [s, f] of uncovered(t, Math.min(t + HOUR, Date.now())))
        db.prepare("INSERT INTO time_entries(activity,task_id,start_at,end_at,source) VALUES (?,?,?,?,'hourly')").run(activity, task_id, new Date(s).toISOString(), new Date(f).toISOString());
      return snapshot();
    },
    "PATCH /api/time/:id": ({ params, body }) => {
      const cur = db.prepare("SELECT * FROM time_entries WHERE id=?").get(params.id);
      if (!cur) throw httpError(404, "Entry not found");
      const activity = "activity" in (body ?? {}) ? activityOf(body.activity) : cur.activity;
      const start = "start_at" in (body ?? {}) ? iso(body.start_at, "start") : cur.start_at;
      const end = "end_at" in (body ?? {}) ? (body.end_at ? iso(body.end_at, "end") : null) : cur.end_at;
      if (end) checkRange(start, end);
      db.prepare("UPDATE time_entries SET activity=?, start_at=?, end_at=? WHERE id=?").run(activity, start, end, cur.id);
      return snapshot();
    },
    "DELETE /api/time/:id": ({ params }) => { db.prepare("DELETE FROM time_entries WHERE id=?").run(params.id); return snapshot(); },
  },
  start() {
    setInterval(() => {
      maybeAskAboutHour().catch(e => console.error("time prompt", e));
      checkForgottenTimer().catch(e => console.error("forgotten timer", e));
    }, 60_000).unref();
  },
};
