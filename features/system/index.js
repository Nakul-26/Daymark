// Backups + export. Backups are consistent SQLite copies (VACUUM INTO) in data/backups, newest 14 kept.
// Copy that folder off the server too: a backup on the same disk isn't a full backup.
import fs from "node:fs";
import path from "node:path";
import { db, dataDir } from "../../core/db.js";

const dir = path.join(dataDir, "backups");

export function backupNow() {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const file = path.join(dir, `daymark-${stamp}.sqlite`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const all = fs.readdirSync(dir).filter(f => f.endsWith(".sqlite")).sort();
  for (const old of all.slice(0, -14)) fs.unlinkSync(path.join(dir, old));
  return path.basename(file);
}
const listBackups = () => fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(f => f.endsWith(".sqlite")).sort().reverse().map(f => ({ name: f, size: fs.statSync(path.join(dir, f)).size }))
  : [];

export default {
  name: "system",
  routes: {
    "GET /api/backups": () => listBackups(),
    "POST /api/backups": () => ({ created: backupNow() }),
    // Everything as JSON (secrets like push keys excluded)
    "GET /api/export": () => {
      const rows = t => db.prepare(`SELECT * FROM ${t}`).all();
      return {
        exported_at: new Date().toISOString(),
        lists: rows("lists"), tasks: rows("tasks"), reminders: rows("reminders"), captures: rows("captures"),
        habits: rows("habits"), habit_logs: rows("habit_logs"), time_entries: rows("time_entries"), notifications: rows("notifications"),
      };
    },
  },
  start() {
    const daily = () => {
      const today = new Date().toISOString().slice(0, 10);
      if (!listBackups().some(b => b.name.includes(today))) {
        try { console.log("backup:", backupNow()); } catch (e) { console.error("backup failed", e); }
      }
    };
    daily();
    setInterval(daily, 3600_000).unref();
  },
};
