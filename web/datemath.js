// Pure date helpers on "YYYY-MM-DD" strings (no timezone, no DOM). Safe to unit test in Node.
const pad = n => String(n).padStart(2, "0");
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const fmt = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
export const weekday = s => parse(s).getUTCDay(); // 0 = Sunday
export const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
export const mondayOf = s => addDays(s, -((weekday(s) + 6) % 7));
export const monthOf = s => s.slice(0, 7);
export const addMonths = (ym, n) => { const [y, m] = ym.split("-").map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`; };
export const daysInMonth = ym => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
