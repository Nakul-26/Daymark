import { db } from "../../core/db.js";
import { httpError } from "../../core/router.js";
import { validTz, validTime } from "../../core/time.js";

// Editable settings and their defaults. Internal keys (vapid keys, last_summary_day) are not listed here.
export const DEFAULTS = {
  timezone: process.env.TZ_DEFAULT || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  default_reminder_time: "09:00", // used when a task has a date but no time
  catch_up_hours: "12",           // reminders older than this after downtime are dropped, not delivered
  daily_summary: "off",
  summary_time: "08:00",
};
const VALIDATE = {
  timezone: validTz,
  default_reminder_time: validTime,
  summary_time: validTime,
  catch_up_hours: v => /^\d{1,3}$/.test(v) && +v >= 1,
  daily_summary: v => v === "on" || v === "off",
};

export const getSetting = key => db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value ?? DEFAULTS[key] ?? null;
export const setSetting = (key, value) =>
  db.prepare("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(value));
export const publicSettings = () => Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, getSetting(k)]));

export default {
  name: "settings",
  migrations: ["CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"],
  routes: {
    "GET /api/settings": () => publicSettings(),
    "PUT /api/settings": ({ body }) => {
      for (const [k, v] of Object.entries(body ?? {})) {
        if (!(k in VALIDATE)) throw httpError(400, `Unknown setting: ${k}`);
        if (!VALIDATE[k](String(v))) throw httpError(400, `Invalid value for ${k}`);
        setSetting(k, v);
      }
      return publicSettings();
    },
  },
};
