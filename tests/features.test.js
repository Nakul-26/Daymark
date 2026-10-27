// Runs the feature handlers directly against a throwaway database (no HTTP needed).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "daymark-test-"));
const { db, migrate } = await import("../core/db.js");
const { events } = await import("../core/events.js");
const mods = {};
for (const n of ["settings", "lists", "tasks", "notifications", "push", "reminders", "captures", "habits", "summary"])
  mods[n] = (await import(`../features/${n}/index.js`)).default;
for (const f of Object.values(mods)) migrate(f.name, f.migrations);
mods.reminders.start(); // registers event listeners (also starts the timer, which is unref'd)
const { tick } = await import("../features/reminders/index.js");
const { dayIn, addDays } = await import("../core/time.js");
const { setSetting, getSetting } = await import("../features/settings/index.js");

const r = (feature, key) => mods[feature].routes[key];
setSetting("timezone", "Asia/Kolkata");
const today = dayIn("Asia/Kolkata");

test("tasks: create, subtasks, edit, soft delete + restore", () => {
  const t = r("tasks", "POST /api/tasks")({ body: { title: "  Parent ", due: today } });
  assert.equal(t.title, "Parent");
  const s = r("tasks", "POST /api/tasks")({ body: { title: "Child", parent_id: t.id } });
  assert.equal(s.list_id, t.list_id);
  assert.throws(() => r("tasks", "POST /api/tasks")({ body: { title: "x", parent_id: s.id } }), /can't have subtasks/);
  assert.throws(() => r("tasks", "POST /api/tasks")({ body: { title: "" } }), /Title required/);
  r("tasks", "PATCH /api/tasks/:id")({ params: { id: t.id }, body: { due_time: "10:30", starred: 1 } });
  assert.equal(r("tasks", "GET /api/tasks")().length, 2);
  r("tasks", "DELETE /api/tasks/:id")({ params: { id: t.id } });
  assert.equal(r("tasks", "GET /api/tasks")().length, 0);
  assert.equal(r("tasks", "POST /api/tasks/:id/restore")({ params: { id: t.id } }).length, 2);
});

test("clearing the date clears time and repeat", () => {
  const t = r("tasks", "POST /api/tasks")({ body: { title: "Rep", due: today, due_time: "08:00", repeat: { freq: "daily", interval: 1 } } });
  const u = r("tasks", "PATCH /api/tasks/:id")({ params: { id: t.id }, body: { due: null } });
  assert.equal(u.due_time, null);
  assert.equal(u.repeat, null);
});

test("repeating task: completing creates the next one; undo removes it", () => {
  const t = r("tasks", "POST /api/tasks")({ body: { title: "Gym", due: today, repeat: { freq: "daily", interval: 1 } } });
  const res = r("tasks", "POST /api/tasks/:id/complete")({ params: { id: t.id } });
  assert.ok(res.task.done_at);
  assert.equal(res.next.due, addDays(today, 1));
  assert.equal(res.next.done_at, null);
  r("tasks", "POST /api/tasks/:id/reopen")({ params: { id: t.id }, body: { remove_id: res.next.id } });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM tasks WHERE id=?").get(res.next.id).c, 0);
});

test("reminders: scheduled, delivered once, skipped when task done, expired after long downtime", async () => {
  const past = new Date(Date.now() - 2 * 60_000);
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(past);
  const t = r("tasks", "POST /api/tasks")({ body: { title: "Call", due: dayIn("Asia/Kolkata", past), due_time: hhmm } });
  const rem = r("reminders", "PUT /api/tasks/:id/reminders")({ params: { id: t.id }, body: { reminders: [{ offset_min: 0 }] } });
  assert.equal(rem.length, 1);
  assert.ok(rem[0].remind_at);
  await tick();
  await tick(); // second tick must not duplicate
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE task_id=?").get(t.id).c, 1);
  assert.equal(db.prepare("SELECT status FROM reminders WHERE task_id=?").get(t.id).status, "sent");

  const t2 = r("tasks", "POST /api/tasks")({ body: { title: "Done already", due: dayIn("Asia/Kolkata", past), due_time: hhmm } });
  r("reminders", "PUT /api/tasks/:id/reminders")({ params: { id: t2.id }, body: { reminders: [{ offset_min: 0 }] } });
  r("tasks", "POST /api/tasks/:id/complete")({ params: { id: t2.id } });
  await tick();
  assert.equal(db.prepare("SELECT status FROM reminders WHERE task_id=?").get(t2.id).status, "skipped");

  const old = new Date(Date.now() - 30 * 3600_000);
  const t3 = r("tasks", "POST /api/tasks")({ body: { title: "Old", due: dayIn("Asia/Kolkata", old), due_time: "00:00" } });
  r("reminders", "PUT /api/tasks/:id/reminders")({ params: { id: t3.id }, body: { reminders: [{ custom_local: `${dayIn("Asia/Kolkata", old)}T00:00` }] } });
  await tick();
  assert.equal(db.prepare("SELECT status FROM reminders WHERE task_id=?").get(t3.id).status, "expired");
});

test("rescheduling a task moves its reminders", () => {
  const t = r("tasks", "POST /api/tasks")({ body: { title: "Move", due: addDays(today, 3), due_time: "10:00" } });
  const [a] = r("reminders", "PUT /api/tasks/:id/reminders")({ params: { id: t.id }, body: { reminders: [{ offset_min: 30 }] } });
  r("tasks", "PATCH /api/tasks/:id")({ params: { id: t.id }, body: { due: addDays(today, 5) } });
  const b = db.prepare("SELECT * FROM reminders WHERE id=?").get(a.id);
  assert.notEqual(a.remind_at, b.remind_at);
  assert.equal(b.remind_at, new Date(Date.parse(a.remind_at) + 2 * 864e5).toISOString());
});

test("captures become tasks", () => {
  const c = r("captures", "POST /api/captures")({ body: { text: "Read about SQLite\nthe WAL part" } });
  const out = r("captures", "POST /api/captures/:id/to-task")({ params: { id: c.id }, body: {} });
  assert.equal(out.task.title, "Read about SQLite");
  assert.equal(out.task.notes, "the WAL part");
  assert.equal(out.capture.status, "archived");
});

test("habits: check toggle and amount logs", () => {
  const chk = r("habits", "POST /api/habits")({ body: { name: "Exercise", kind: "check", days: [1, 2, 3, 4, 5] } });
  assert.equal(r("habits", "POST /api/habits/:id/toggle")({ params: { id: chk.id }, body: { day: today } }).length, 1);
  assert.equal(r("habits", "POST /api/habits/:id/toggle")({ params: { id: chk.id }, body: { day: today } }).length, 0);
  const amt = r("habits", "POST /api/habits")({ body: { name: "DSA", kind: "amount", unit: "h", weekly_target: 14 } });
  r("habits", "POST /api/habits/:id/logs")({ params: { id: amt.id }, body: { day: today, amount: 1.5 } });
  r("habits", "POST /api/habits/:id/logs")({ params: { id: amt.id }, body: { day: today, amount: 2 } });
  const { habits, logs } = r("habits", "GET /api/habits")();
  assert.equal(habits.length, 2);
  assert.equal(logs.filter(l => l.habit_id === amt.id).reduce((a, l) => a + l.amount, 0), 3.5);
  assert.throws(() => r("habits", "POST /api/habits/:id/logs")({ params: { id: amt.id }, body: { day: today, amount: -1 } }), /Invalid amount/);
});

test("settings validate", () => {
  assert.throws(() => r("settings", "PUT /api/settings")({ body: { timezone: "Mars/Base" } }), /Invalid/);
  assert.equal(r("settings", "PUT /api/settings")({ body: { summary_time: "07:15" } }).summary_time, "07:15");
  assert.equal(getSetting("timezone"), "Asia/Kolkata");
});

test("tasks: indent under a task, unindent back; subtasks lose their repeat", () => {
  const mk = body => r("tasks", "POST /api/tasks")({ body });
  const patch = (id, body) => r("tasks", "PATCH /api/tasks/:id")({ params: { id }, body });
  const parent = mk({ title: "Indent parent" });
  const kid = mk({ title: "Indent kid", due: today, repeat: { freq: "daily", interval: 1 } });
  const moved = patch(kid.id, { parent_id: parent.id, position: 1 });
  assert.equal(moved.parent_id, parent.id);
  assert.equal(moved.list_id, parent.list_id);
  assert.equal(moved.repeat, null);
  const back = patch(kid.id, { parent_id: null });
  assert.equal(back.parent_id, null);
  const other = mk({ title: "Has a kid" });
  mk({ title: "its kid", parent_id: other.id });
  assert.throws(() => patch(other.id, { parent_id: parent.id }), /subtasks can't become a subtask/);
});
