// Daymark server. To add/remove a backend feature, edit the FEATURES list below.
// A feature is { name, migrations?, routes?, start? }: see features/lists for the smallest example.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "./core/db.js";
import { buildRouter } from "./core/router.js";
import { authEnabled, isAuthed, login, logoutCookie, revokeAll } from "./core/auth.js";
import settings from "./features/settings/index.js";
import lists from "./features/lists/index.js";
import tasks from "./features/tasks/index.js";
import notifications from "./features/notifications/index.js";
import push from "./features/push/index.js";
import reminders from "./features/reminders/index.js";
import captures from "./features/captures/index.js";
import habits from "./features/habits/index.js";
import summary from "./features/summary/index.js";
import reports from "./features/reports/index.js";
import time from "./features/time/index.js";
import system from "./features/system/index.js";

// Order matters for migrations: a feature must come after the ones whose tables it references.
const FEATURES = [settings, lists, tasks, notifications, push, reminders, captures, habits, time, summary, reports, system];

for (const f of FEATURES) migrate(f.name, f.migrations);
const route = buildRouter(FEATURES);

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png",
};

const send = (res, status, data, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
  res.end(JSON.stringify(data));
};

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e6) throw Object.assign(new Error("Too large"), { status: 413 });
  }
  let body;
  try { body = raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error("Bad JSON"), { status: 400 }); }
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw Object.assign(new Error("Bad JSON"), { status: 400 });
  return body;
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  try {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/health") return send(res, 200, { ok: true });
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/session") return send(res, 200, { authed: isAuthed(req), authEnabled });
      const writes = req.method !== "GET";
      // CSRF guard: browsers can't add this header on cross-site form posts
      if (writes && req.headers["x-requested-with"] !== "daymark") return send(res, 403, { error: "Bad request" });
      const body = writes && req.method !== "DELETE" ? await readBody(req) : undefined;
      if (url.pathname === "/api/login" && req.method === "POST") {
        const r = login(req, body?.password);
        return r.cookie ? send(res, 200, { ok: true }, { "Set-Cookie": r.cookie }) : send(res, r.status, { error: r.error });
      }
      if (url.pathname === "/api/logout" && req.method === "POST") return send(res, 200, { ok: true }, { "Set-Cookie": logoutCookie() });
      if (!isAuthed(req)) return send(res, 401, { error: "Not signed in" });
      if (url.pathname === "/api/logout-all" && req.method === "POST") { revokeAll(); return send(res, 200, { ok: true }, { "Set-Cookie": logoutCookie() }); }
      const out = await route(req.method, url.pathname, Object.fromEntries(url.searchParams), body);
      if (writes) console.log(JSON.stringify({ t: new Date().toISOString(), m: req.method, p: url.pathname, ms: Date.now() - started }));
      return out ? send(res, out.status, out.data) : send(res, 404, { error: "Not found" });
    }
    // static files from /web (unknown paths fall back to index.html)
    let file = path.normalize(path.join(WEB, url.pathname === "/" ? "index.html" : url.pathname));
    if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB, "index.html");
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (!e.status) console.error(JSON.stringify({ t: new Date().toISOString(), error: e.stack }));
    send(res, e.status || 500, { error: e.status ? e.message : "Server error" });
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Daymark on http://localhost:${port}${authEnabled ? "" : "  (no PASSWORD set: open access)"}`);
  for (const f of FEATURES) f.start?.();
});
