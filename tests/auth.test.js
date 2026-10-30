import test from "node:test";
import assert from "node:assert/strict";

process.env.PASSWORD = "secret";
process.env.TRUST_PROXY = "true";
const { login } = await import("../core/auth.js");
const req = ip => ({ headers: { "cf-connecting-ip": ip }, socket: { remoteAddress: "10.0.0.1" } });

test("login limit counts each visitor separately behind a proxy", () => {
  for (let i = 0; i < 10; i++) assert.equal(login(req("1.1.1.1"), "wrong").status, 401);
  assert.equal(login(req("1.1.1.1"), "secret").status, 429, "the guesser is locked out");
  assert.equal(login(req("2.2.2.2"), "secret").status, 200, "the owner, from another address, is not");
});
