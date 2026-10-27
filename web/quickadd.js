// Quick-add parsing for the "Add a task" box. Trailing words are turned into fields:
//   "Call mom tomorrow 5pm !"  ->  title "Call mom", due tomorrow, 17:00, starred
// Supported: today, tomorrow, weekday names (mon, tuesday...), "5pm" / "at 17:30", and a trailing "!".
// Pure function (no DOM): easy to extend or unit test.
import { addDays, weekday } from "./datemath.js";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function parseQuick(text, today) {
  let title = text.trim();
  const out = {};
  let m;
  if ((m = title.match(/\s*!\s*$/)) && title.length > m[0].length) { out.starred = 1; title = title.slice(0, m.index).trim(); }

  if ((m = title.match(/\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i)) || (m = title.match(/\s+at\s+(\d{1,2}):(\d{2})()$/i))) {
    let hh = +m[1]; const mm = +(m[2] || 0), ap = (m[3] || "").toLowerCase();
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
    if (hh < 24 && mm < 60 && title.length > m[0].length) {
      out.due_time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      title = title.slice(0, m.index).trim();
    }
  }

  if ((m = title.match(/\s+(today|tomorrow|(sun|mon|tue|wed|thu|fri|sat)[a-z]*)$/i)) && title.length > m[0].length) {
    const w = m[1].toLowerCase();
    const idx = DAYS.indexOf(w.slice(0, 3));
    if (w === "today") out.due = today;
    else if (w === "tomorrow") out.due = addDays(today, 1);
    else if (idx >= 0 && /^(sun|mon|tue|wed|thu|fri|sat)(day|sday|nesday|rsday|urday|s|r|rs)?$/.test(w)) out.due = addDays(today, ((idx - weekday(today) + 6) % 7) + 1);
    if (out.due) title = title.slice(0, m.index).trim();
  }
  if (out.due_time && !out.due) out.due = today; // "Call mom 5pm" means today at 5pm
  return { title, ...out };
}
