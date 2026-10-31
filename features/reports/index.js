// Daily and weekly reports: numbers for a day or a Monday-Sunday week, plus an automatic notification
// at the times chosen in Settings. The same numbers feed the Reports page, so it can be opened any time.
import { db } from "../../core/db.js";
import { httpError } from "../../core/router.js";
import { dayIn, timeIn, weekday, addDays, localToUtc, validDay } from "../../core/time.js";
import { getSetting, setSetting } from "../settings/index.js";
import { createNotification } from "../notifications/index.js";
import { pushToAll } from "../push/index.js";

const mondayOf = day => addDays(day, -((weekday(day) + 6) % 7));
const dur = ms => { const m = Math.round(ms / 60000); return m < 1 ? "0m" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };

// Did the plan fit the day? Planned = tasks due in the period (up to today); done = finished by the end of it.
// "Capacity" is what you actually finish on a normal day, from the 14 days before the period.
function planCheck(from, to, today, lo, hi, nDays, tz) {
  const last = to < today ? to : today;
  if (from > last) return { planned: 0, done: 0, missed: [], missedCount: 0, extra: 0, rate: null, capacity: null, verdict: "" };
  const rows = db.prepare("SELECT title, done_at FROM tasks WHERE deleted_at IS NULL AND due>=? AND due<=? ORDER BY due, position").all(from, last);
  const isDone = t => t.done_at && t.done_at < hi;
  const missed = rows.filter(t => !isDone(t)).map(t => t.title);
  const planned = rows.length, done = planned - missed.length;
  const extra = db.prepare("SELECT COUNT(*) c FROM tasks WHERE deleted_at IS NULL AND done_at>=? AND done_at<? AND (due IS NULL OR due<? OR due>?)").get(lo, hi, from, last).c;

  const perDay = new Map();
  for (const t of db.prepare("SELECT done_at FROM tasks WHERE deleted_at IS NULL AND done_at>=? AND done_at<?").all(new Date(new Date(lo).getTime() - 14 * 864e5).toISOString(), lo)) {
    const d = dayIn(tz, new Date(t.done_at)); perDay.set(d, (perDay.get(d) || 0) + 1);
  }
  const counts = [...perDay.values()];
  const capacity = counts.length >= 3 ? Math.round(counts.reduce((a, b) => a + b, 0) / counts.length * 10) / 10 : null;

  const rate = planned ? done / planned : null, per = planned / Math.max(1, nDays), wk = nDays > 1 ? " a day" : "";
  let verdict;
  if (!planned) verdict = "Nothing was scheduled, so there was no plan to check.";
  else if (rate >= 0.85) verdict = "Well planned: you finished almost everything you scheduled.";
  else if (capacity && per > capacity * 1.25) verdict = `Too much on the plate: you scheduled about ${Math.round(per * 10) / 10}${wk}, but you usually finish about ${capacity}. Try scheduling ${Math.max(1, Math.round(capacity))}${wk}.`;
  else if (rate < 0.5) verdict = capacity ? "You scheduled a normal amount but finished under half. Something got in the way: check where the time went." : "You finished under half of what you scheduled. If that keeps happening, schedule fewer tasks.";
  else verdict = "A reasonable plan: most got done and a few slipped to later.";
  return { planned, done, missed: missed.slice(0, 15), missedCount: missed.length, extra, rate, capacity, verdict };
}

export function buildReport(period, anchor, now = new Date()) {
  const tz = getSetting("timezone"), today = dayIn(tz, now);
  const from = period === "week" ? mondayOf(anchor) : anchor, to = period === "week" ? addDays(from, 6) : anchor;
  const days = Array.from({ length: period === "week" ? 7 : 1 }, (_, i) => addDays(from, i));
  const lo = localToUtc(from, "00:00", tz), hi = localToUtc(addDays(to, 1), "00:00", tz);

  const done = db.prepare("SELECT title, done_at FROM tasks WHERE deleted_at IS NULL AND done_at>=? AND done_at<? ORDER BY done_at")
    .all(lo, hi).map(t => ({ title: t.title, day: dayIn(tz, new Date(t.done_at)) }));
  const created = db.prepare("SELECT COUNT(*) c FROM tasks WHERE deleted_at IS NULL AND created_at>=? AND created_at<?").get(lo.replace("T", " ").slice(0, 19), hi.replace("T", " ").slice(0, 19)).c;
  const tasks = {
    done: done.length, created,
    list: done.slice(-30).reverse(),
    byDay: days.map(day => ({ day, n: done.filter(t => t.day === day).length })),
    open: db.prepare("SELECT COUNT(*) c FROM tasks WHERE deleted_at IS NULL AND done_at IS NULL").get().c,
    overdue: db.prepare("SELECT COUNT(*) c FROM tasks WHERE deleted_at IS NULL AND done_at IS NULL AND due IS NOT NULL AND due<?").get(today).c,
  };

  const plan = planCheck(from, to, today, lo, hi, days.filter(d => d <= today).length, tz);

  const habits = db.prepare("SELECT * FROM habits WHERE archived_at IS NULL ORDER BY id").all().map(hb => {
    const sched = JSON.parse(hb.days), upto = days.filter(d => d <= today);
    const scheduled = upto.filter(d => sched.includes(weekday(d))).length;
    const logs = db.prepare("SELECT day, amount FROM habit_logs WHERE habit_id=? AND day>=? AND day<=?").all(hb.id, from, to);
    const hit = new Set(logs.filter(l => sched.includes(weekday(l.day))).map(l => l.day)).size; // days off the schedule don't count towards "x of y"
    const amount = logs.reduce((a, l) => a + l.amount, 0);
    return { name: hb.name, kind: hb.kind, unit: hb.unit, scheduled, hit, amount, missed: Math.max(0, scheduled - hit), weekly_target: hb.weekly_target };
  });
  const sch = habits.reduce((a, x) => a + x.scheduled, 0), hit = habits.reduce((a, x) => a + Math.min(x.hit, x.scheduled), 0);

  const per = new Map(), perDay = days.map(day => ({ day, ms: 0 }));
  const nowMs = now.getTime();
  for (const e of db.prepare("SELECT activity, start_at, end_at FROM time_entries WHERE start_at<? AND (end_at IS NULL OR end_at>?)").all(hi, lo)) {
    const s = new Date(e.start_at).getTime(), f = e.end_at ? new Date(e.end_at).getTime() : nowMs;
    const a = Math.max(s, new Date(lo).getTime()), b = Math.min(f, new Date(hi).getTime());
    if (b <= a) continue;
    per.set(e.activity, (per.get(e.activity) || 0) + b - a);
    for (const d of perDay) {
      const x = Math.max(a, new Date(localToUtc(d.day, "00:00", tz)).getTime()), y = Math.min(b, new Date(localToUtc(addDays(d.day, 1), "00:00", tz)).getTime());
      if (y > x) d.ms += y - x;
    }
  }
  const time = { totalMs: perDay.reduce((a, d) => a + d.ms, 0), byDay: perDay, byActivity: [...per].map(([activity, ms]) => ({ activity, ms })).sort((a, b) => b.ms - a.ms) };

  return { period, from, to, today, tasks, plan, habits, habitRate: sch ? hit / sch : null, habitHit: hit, habitScheduled: sch, time };
}

const names = (list, n = 3) => list.slice(0, n).join(", ") + (list.length > n ? `, +${list.length - n} more` : "");

// Title and body of the notification: how the plan went, what slipped, and whether it was too much.
function message(kind, r, prev) {
  const p = r.plan, word = kind === "week" ? "week" : "day";
  const title = p.planned ? `Your ${word}: ${p.done} of ${p.planned} planned done` : `Your ${word} in Daymark`;
  const lines = [];
  if (p.missedCount) lines.push(`Not done: ${names(p.missed)}`);
  const hm = r.habits.filter(x => x.missed > 0).map(x => kind === "week" ? `${x.name} (${x.missed})` : x.name);
  if (hm.length) lines.push(`Habits missed: ${names(hm)}`);
  else if (r.habitScheduled) lines.push(`Habits: all ${r.habitScheduled} done`);
  if (p.verdict && p.planned) lines.push(p.verdict);
  const extras = [];
  if (p.extra) extras.push(`${p.extra} extra done`);
  if (r.time.totalMs) extras.push(`${dur(r.time.totalMs)} tracked`);
  if (r.tasks.overdue) extras.push(`${r.tasks.overdue} older overdue`);
  if (prev) extras.push(`last week ${prev.tasks.done} done`);
  if (extras.length) lines.push(extras.join(" · "));
  return { title, body: lines.join("\n") || "Nothing scheduled and nothing logged." };
}

async function send(kind, r, prev) {
  const { title, body } = message(kind, r, prev);
  createNotification({ type: "report", title, body });
  await pushToAll({ title, body, url: `/#/report/${kind}`, tag: `report-${kind}` });
}

// Called every minute. Each report goes out once per day / week (marker set first).
export async function maybeSendReports(now = new Date()) {
  const tz = getSetting("timezone"), day = dayIn(tz, now), clock = timeIn(tz, now);
  let sent = 0;
  if (getSetting("daily_report") === "on" && clock >= getSetting("daily_report_time") && getSetting("report_day_last") !== day) {
    setSetting("report_day_last", day);
    await send("day", buildReport("day", day, now)); sent++;
  }
  if (getSetting("weekly_report") === "on" && String(weekday(day)) === getSetting("weekly_report_day")
      && clock >= getSetting("weekly_report_time") && getSetting("report_week_last") !== day) {
    setSetting("report_week_last", day);
    await send("week", buildReport("week", day, now), buildReport("week", addDays(day, -7), now)); sent++;
  }
  return sent;
}

export default {
  name: "reports",
  routes: {
    "GET /api/report": ({ query }) => {
      const period = query.period === "week" ? "week" : "day", date = query.date || dayIn(getSetting("timezone"));
      if (!validDay(date)) throw httpError(400, "Bad date");
      return buildReport(period, date);
    },
  },
  start() {
    setInterval(() => maybeSendReports().catch(e => console.error("reports", e)), 60_000).unref();
  },
};
