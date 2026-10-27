// Optional daily summary notification ("3 tasks today, 2 habits to do"). Off by default; enable in Settings.
import { db } from "../../core/db.js";
import { dayIn, timeIn, weekday } from "../../core/time.js";
import { getSetting, setSetting } from "../settings/index.js";
import { createNotification } from "../notifications/index.js";
import { pushToAll } from "../push/index.js";

export async function maybeSendSummary(now = new Date()) {
  if (getSetting("daily_summary") !== "on") return false;
  const tz = getSetting("timezone"), day = dayIn(tz, now);
  if (getSetting("last_summary_day") === day || timeIn(tz, now) < getSetting("summary_time")) return false;
  setSetting("last_summary_day", day); // set first: never send twice

  const tasks = db.prepare("SELECT COUNT(*) c FROM tasks WHERE deleted_at IS NULL AND done_at IS NULL AND due IS NOT NULL AND due<=?").get(day).c;
  const wd = weekday(day);
  const habits = db.prepare(`SELECT h.days, (SELECT COUNT(*) FROM habit_logs l WHERE l.habit_id=h.id AND l.day=?) logged
    FROM habits h WHERE h.archived_at IS NULL`).all(day).filter(h => JSON.parse(h.days).includes(wd) && !h.logged).length;
  if (!tasks && !habits) return false;
  const body = [tasks && `${tasks} task${tasks > 1 ? "s" : ""} due`, habits && `${habits} habit${habits > 1 ? "s" : ""} to do`].filter(Boolean).join(", ");
  createNotification({ type: "summary", title: "Today in Daymark", body });
  await pushToAll({ title: "Today in Daymark", body, url: "/#/myday", tag: "daily-summary" });
  return true;
}

export default {
  name: "summary",
  start() {
    setInterval(() => maybeSendSummary().catch(e => console.error("summary", e)), 60_000).unref();
  },
};
