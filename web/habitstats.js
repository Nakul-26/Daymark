// Habit maths: pure functions, no DOM. All "day" values are "YYYY-MM-DD" in the user's timezone.
// A habit: { kind: "check"|"amount", days: [weekdays], weekly_target, daily_target }.
import { addDays, weekday, mondayOf } from "./datemath.js";

// totals(habitId, day) -> sum of logged amounts that day
export function makeTotals(logs) {
  const m = new Map();
  for (const l of logs) m.set(`${l.habit_id}|${l.day}`, (m.get(`${l.habit_id}|${l.day}`) || 0) + l.amount);
  return (habitId, day) => m.get(`${habitId}|${day}`) || 0;
}

export const scheduled = (h, day) => h.days.includes(weekday(day));
export const dayDone = (h, total) => (h.kind === "amount" && h.daily_target ? total >= h.daily_target : total > 0);
// "week" habits are judged on the weekly total (e.g. 14 h of DSA); everything else is judged per scheduled day.
export const streakMode = h => (h.weekly_target && !h.daily_target ? "week" : "day");

export function weekProgress(h, totals, anyDayInWeek) {
  const start = mondayOf(anyDayInWeek);
  let done = 0, sum = 0, scheduledDays = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i), t = totals(h.id, d);
    sum += t;
    if (scheduled(h, d)) scheduledDays++;
    if (dayDone(h, t)) done++;
  }
  const value = h.kind === "amount" ? sum : done;
  const target = h.weekly_target ?? (h.kind === "check" ? scheduledDays : null);
  return { value, target, pct: target ? Math.min(1, value / target) : null, met: target ? value >= target : false };
}

export function streak(h, totals, today) {
  let n = 0;
  if (streakMode(h) === "week") {
    let w = mondayOf(today);
    if (!weekProgress(h, totals, w).met) w = addDays(w, -7); // this week still in progress: don't break the streak
    while (weekProgress(h, totals, w).met && n < 520) { n++; w = addDays(w, -7); }
    return { n, unit: "week" };
  }
  let d = today;
  if (scheduled(h, d) && !dayDone(h, totals(h.id, d))) d = addDays(d, -1); // today not done yet
  for (let i = 0; i < 800; i++, d = addDays(d, -1)) {
    if (!scheduled(h, d)) continue;
    if (!dayDone(h, totals(h.id, d))) break;
    n++;
  }
  return { n, unit: "day" };
}

// Last `n` days ending today, oldest first.
export function history(h, totals, today, n) {
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(today, i - (n - 1)), total = totals(h.id, day);
    return { day, scheduled: scheduled(h, day), total, done: dayDone(h, total) };
  });
}

export function weeklyBars(h, totals, today, n) {
  return Array.from({ length: n }, (_, i) => {
    const start = addDays(mondayOf(today), -7 * (n - 1 - i));
    return { start, ...weekProgress(h, totals, start) };
  });
}

// Share of scheduled days (that have already started) completed over the last n days.
export function adherence(h, totals, today, n) {
  const days = history(h, totals, today, n).filter(x => x.scheduled && x.day <= today);
  return days.length ? days.filter(x => x.done).length / days.length : null;
}
