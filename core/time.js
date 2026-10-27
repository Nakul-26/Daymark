// Date helpers. Task dates are plain "YYYY-MM-DD" (+ optional "HH:MM") in the user's timezone.
// Only reminders need real instants; localToUtc converts using the configured timezone.

const pad = n => String(n).padStart(2, "0");
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
export const weekday = s => parse(s).getUTCDay(); // 0 = Sunday
export const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);

// "YYYY-MM-DD" of an instant in a timezone.
export function dayIn(tz, date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
// "HH:MM" of an instant in a timezone.
export function timeIn(tz, date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(date).map(x => [x.type, x.value]));
  return `${p.hour}:${p.minute}`;
}

function offsetMs(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// Wall-clock time in `tz` -> UTC ISO string.
export function localToUtc(day, time, tz) {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ms = guess - offsetMs(guess, tz);
  ms = guess - offsetMs(ms, tz); // second pass handles DST edges
  return new Date(ms).toISOString();
}

export const validDay = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parse(s)) && fmt(parse(s)) === s;
export const validTime = s => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const validTz = tz => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };

// ---- Recurrence ----
// rule = { freq: "daily"|"weekly"|"monthly"|"yearly", interval: 1..99, days?: [0..6] (weekly only) }
export function validRule(r) {
  if (!r || typeof r !== "object") return null;
  if (!["daily", "weekly", "monthly", "yearly"].includes(r.freq)) return null;
  const interval = Math.min(99, Math.max(1, Math.floor(Number(r.interval) || 1)));
  const rule = { freq: r.freq, interval };
  if (r.freq === "weekly" && Array.isArray(r.days) && r.days.length)
    rule.days = [...new Set(r.days.map(Number).filter(d => d >= 0 && d <= 6))].sort();
  // Optional end (Google Tasks "Ends"): { on: "YYYY-MM-DD" } or { count: N } = N occurrences left, counting the current one.
  if (r.end && typeof r.end === "object") {
    if (validDay(r.end.on)) rule.end = { on: r.end.on };
    else if (Number(r.end.count) >= 1) rule.end = { count: Math.min(999, Math.floor(Number(r.end.count))) };
  }
  return rule;
}

// Same repeat pattern, ignoring when it ends (editing only the end must not restart the series).
export const sameSchedule = (a, b) => !!a && !!b && a.freq === b.freq && a.interval === b.interval
  && JSON.stringify(a.days ?? []) === JSON.stringify(b.days ?? []);

// The rule the next occurrence carries, or null when the series ends before `nextDue`.
export function nextRuleFor(rule, nextDue) {
  const end = rule.end;
  if (end?.on && nextDue > end.on) return null;
  if (end?.count != null) return end.count <= 1 ? null : { ...rule, end: { count: end.count - 1 } };
  return rule;
}

function addMonths(s, n, keepDay) {
  const d = parse(s);
  const target = d.getUTCMonth() + n;
  const y = d.getUTCFullYear() + Math.floor(target / 12), m = ((target % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(y, m, Math.min(keepDay ?? d.getUTCDate(), last))));
}

// The occurrence strictly after `from`.
export function nextAfter(rule, from) {
  const { freq, interval } = rule;
  if (freq === "daily") return addDays(from, interval);
  if (freq === "weekly") {
    if (!rule.days) return addDays(from, 7 * interval);
    const weekStart = addDays(from, -weekday(from)); // Sunday of from's week
    for (let i = 1; i <= 7 * interval * 2; i++) {
      const d = addDays(from, i);
      const weeks = Math.floor(diffDays(addDays(d, -weekday(d)), weekStart) / 7);
      if (weeks % interval === 0 && rule.days.includes(weekday(d))) return d;
    }
  }
  if (freq === "monthly") return addMonths(from, interval, parse(from).getUTCDate());
  return addMonths(from, 12 * interval, parse(from).getUTCDate());
}

// Next occurrence after `due` that is not in the past (so a long-overdue repeat doesn't pile up).
export function nextOccurrence(rule, due, today) {
  let d = nextAfter(rule, due);
  for (let i = 0; d < today && i < 4000; i++) d = nextAfter(rule, d);
  return d;
}
