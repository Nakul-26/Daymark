import test from "node:test";
import assert from "node:assert/strict";
import { localToUtc, nextAfter, nextOccurrence, validRule, addDays, dayIn } from "../core/time.js";

test("localToUtc handles India (+5:30) and New York DST", () => {
  assert.equal(localToUtc("2026-10-20", "10:00", "Asia/Kolkata"), "2026-10-20T04:30:00.000Z");
  assert.equal(localToUtc("2026-07-01", "09:00", "America/New_York"), "2026-07-01T13:00:00.000Z");
  assert.equal(localToUtc("2026-01-01", "09:00", "America/New_York"), "2026-01-01T14:00:00.000Z");
});

test("recurrence", () => {
  assert.equal(nextAfter({ freq: "daily", interval: 3 }, "2026-10-30"), "2026-11-02");
  assert.equal(nextAfter({ freq: "monthly", interval: 1 }, "2026-01-31"), "2026-02-28");
  assert.equal(nextAfter({ freq: "yearly", interval: 1 }, "2028-02-29"), "2029-02-28");
  // 2026-10-19 is Monday. Mon/Wed/Fri: Mon -> Wed, Fri -> next Mon
  const mwf = { freq: "weekly", interval: 1, days: [1, 3, 5] };
  assert.equal(nextAfter(mwf, "2026-10-19"), "2026-10-21");
  assert.equal(nextAfter(mwf, "2026-10-23"), "2026-10-26");
  // every 2 weeks on Monday
  assert.equal(nextAfter({ freq: "weekly", interval: 2, days: [1] }, "2026-10-19"), "2026-11-02");
  assert.equal(nextAfter({ freq: "weekly", interval: 1 }, "2026-10-19"), "2026-10-26");
});

test("nextOccurrence skips the past", () => {
  assert.equal(nextOccurrence({ freq: "daily", interval: 1 }, "2026-10-01", "2026-10-18"), "2026-10-18");
});

test("validRule normalises", () => {
  assert.deepEqual(validRule({ freq: "weekly", interval: "2", days: [5, 1, 1, 9] }), { freq: "weekly", interval: 2, days: [1, 5] });
  assert.equal(validRule({ freq: "hourly" }), null);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.match(dayIn("Asia/Kolkata"), /^\d{4}-\d{2}-\d{2}$/);
});
