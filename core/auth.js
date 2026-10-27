// Single-user auth. Set PASSWORD in the environment to require login; leave it empty for no login
// (fine on localhost only). The cookie is a stateless HMAC, so there is no sessions table.
import { createHmac, timingSafeEqual } from "node:crypto";

const PASSWORD = process.env.PASSWORD || "";
export const authEnabled = !!PASSWORD;
const token = createHmac("sha256", PASSWORD).update("daymark-session").digest("hex");
const COOKIE = "dm";

const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function isAuthed(req) {
  if (!authEnabled) return true;
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|; )${COOKIE}=([a-f0-9]+)`));
  return !!m && same(m[1], token);
}

const fails = new Map(); // ip -> { n, t }
export function login(req, password) {
  const ip = req.socket.remoteAddress;
  const f = fails.get(ip);
  const recent = f && Date.now() - f.t < 600_000;
  if (recent && f.n >= 10) return { status: 429, error: "Too many attempts, wait 10 minutes" };
  if (!authEnabled || !same(String(password ?? ""), PASSWORD)) {
    fails.set(ip, { n: (recent ? f.n : 0) + 1, t: recent ? f.t : Date.now() });
    return { status: 401, error: "Wrong password" };
  }
  fails.delete(ip);
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return { status: 200, cookie: `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}${secure}` };
}

export const logoutCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
