import test from "node:test";
import assert from "node:assert/strict";
import { makeTotals, streak, weekProgress, adherence } from "../web/habitstats.js";

// 2026-10-18 is a Sunday; the week is Mon 12th .. Sun 18th
const log = (habit_id, day, amount = 1) => ({ habit_id, day, amount });

test("daily check habit streak ignores unscheduled days and an unfinished today", () => {
  const h = { id: 1, kind: "check", days: [1, 2, 3, 4, 5], weekly_target: null, daily_target: null };
  const totals = makeTotals([log(1, "2026-10-14"), log(1, "2026-10-15"), log(1, "2026-10-16")]); // Wed-Fri
  assert.deepEqual(streak(h, totals, "2026-10-18"), { n: 3, unit: "day" }); // Sunday not scheduled, Mon/Tue missing
  const t2 = makeTotals([log(1, "2026-10-12"), log(1, "2026-10-13"), ...[14, 15, 16].map(d => log(1, `2026-10-${d}`))]);
  assert.equal(streak(h, t2, "2026-10-18").n, 5);
});

test("weekly amount goal: progress and weekly streak", () => {
  const h = { id: 2, kind: "amount", unit: "h", days: [0, 1, 2, 3, 4, 5, 6], weekly_target: 14, daily_target: null };
  const totals = makeTotals([log(2, "2026-10-12", 4), log(2, "2026-10-13", 5.5), log(2, "2026-10-14", 4.5), log(2, "2026-10-05", 14), log(2, "2026-09-28", 15)]);
  const p = weekProgress(h, totals, "2026-10-18");
  assert.equal(p.value, 14);
  assert.equal(p.met, true);
  assert.deepEqual(streak(h, totals, "2026-10-18"), { n: 3, unit: "week" }); // this week + two previous
});

test("adherence", () => {
  const h = { id: 3, kind: "check", days: [0, 1, 2, 3, 4, 5, 6], weekly_target: null, daily_target: null };
  const totals = makeTotals([log(3, "2026-10-17"), log(3, "2026-10-18")]);
  assert.equal(adherence(h, totals, "2026-10-18", 4), 0.5);
});
