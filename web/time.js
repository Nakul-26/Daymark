// Timezone-aware helpers (uses the timezone from Settings). Pure date maths is in datemath.js.
import { state } from "./state.js";
import { addDays } from "./datemath.js";
export * from "./datemath.js";

const fmts = {};
const dayFmt = tz => (fmts[tz] ??= new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }));
export const isoDay = (date = new Date()) => dayFmt(state.settings.timezone).format(date);
export const dayOf = iso => isoDay(new Date(iso)); // a timestamp -> its day in the user's timezone

export function dueLabel(due, time) {
  if (!due) return "";
  const today = isoDay();
  let label;
  if (due === today) label = "Today";
  else if (due === addDays(today, 1)) label = "Tomorrow";
  else if (due === addDays(today, -1)) label = "Yesterday";
  else label = new Date(due + "T12:00Z").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC", ...(due.slice(0, 4) !== today.slice(0, 4) && { year: "numeric" }) });
  return time ? `${label}, ${clock(time)}` : label;
}
export const clock = hhmm => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
};
export const longDate = day => new Date(day + "T12:00Z").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
export const shortDate = day => new Date(day + "T12:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
export const monthTitle = ym => new Date(ym + "-15T12:00Z").toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
export const agoLabel = iso => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export function repeatLabel(r) {
  if (!r) return "";
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[r.freq];
  let label = r.interval > 1 ? `Every ${r.interval} ${unit}s` : `Every ${unit}`;
  if (r.freq === "weekly" && r.days?.length) label += ` on ${r.days.map(d => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ")}`;
  if (r.end?.on) label += `, until ${shortDate(r.end.on)}`;
  if (r.end?.count != null) label += r.end.count > 1 ? `, ${r.end.count} left` : ", last one";
  return label;
}
