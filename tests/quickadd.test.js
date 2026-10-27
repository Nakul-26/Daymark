import test from "node:test";
import assert from "node:assert/strict";
import { parseQuick } from "../web/quickadd.js";

const today = "2026-10-18"; // Sunday
test("quick add", () => {
  assert.deepEqual(parseQuick("Call mom tomorrow 5pm !", today), { title: "Call mom", starred: 1, due_time: "17:00", due: "2026-10-19" });
  assert.deepEqual(parseQuick("Submit report friday", today), { title: "Submit report", due: "2026-10-23" });
  assert.deepEqual(parseQuick("Gym sunday", today), { title: "Gym", due: "2026-10-25" });
  assert.deepEqual(parseQuick("Standup at 09:30", today), { title: "Standup", due_time: "09:30", due: today });
  assert.deepEqual(parseQuick("today", today), { title: "today" });
  assert.deepEqual(parseQuick("Buy milk", today), { title: "Buy milk" });
  assert.deepEqual(parseQuick("Read monday notes", today), { title: "Read monday notes" });
});
