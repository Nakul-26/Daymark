import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "daymark-auth-"));
process.env.PASSWORD = "secret";
process.env.TRUST_PROXY = "true";
const { migrate } = await import("../core/db.js");
migrate("settings", (await import("../features/settings/index.js")).default.migrations);
const { login, isAuthed, revokeAll } = await import("../core/auth.js");
const req = (ip, cookie = "") => ({ headers: { "cf-connecting-ip": ip, cookie }, socket: { remoteAddress: "10.0.0.1" } });

test("login limit counts each visitor separately behind a proxy", () => {
  for (let i = 0; i < 10; i++) assert.equal(login(req("1.1.1.1"), "wrong").status, 401);
  assert.equal(login(req("1.1.1.1"), "secret").status, 429, "the guesser is locked out");
  assert.equal(login(req("2.2.2.2"), "secret").status, 200, "the owner, from another address, is not");
});

test("sign out everywhere invalidates cookies issued before", () => {
  const cookie = login(req("3.3.3.3"), "secret").cookie.split(";")[0];
  assert.ok(isAuthed(req("3.3.3.3", cookie)));
  revokeAll();
  assert.ok(!isAuthed(req("3.3.3.3", cookie)), "old cookie no longer works");
  const fresh = login(req("3.3.3.3"), "secret").cookie.split(";")[0];
  assert.ok(isAuthed(req("3.3.3.3", fresh)), "signing in again works");
});
