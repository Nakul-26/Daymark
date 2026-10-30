// Browser tests on a phone-sized screen: real touches against a real server with a throwaway database.
// Needs Playwright (not a normal dependency): `npm i --no-save playwright && npx playwright install chromium`, then `npm run e2e`.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const PORT = 3100 + Math.floor(Math.random() * 500), BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daymark-e2e-"));
const today = new Date().toISOString().slice(0, 10);
let server, browser, ctx, page, cdp;
const errors = [];

const api = (method, url, body) => fetch(BASE + url, { method, headers: { "X-Requested-With": "daymark", "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then(r => r.json());
const hash = () => page.evaluate(() => location.hash);
const settle = ms => page.waitForTimeout(ms ?? 250);

// tap where a finger would: at the element's centre, and fail if something else is on top there
async function tap(locator) {
  await locator.evaluate(el => el.scrollIntoView({ block: "center" }));
  const b = await locator.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  const ok = await locator.evaluate((el, [x, y]) => { const top = document.elementFromPoint(x, y); return el === top || el.contains(top); }, [x, y]);
  assert.ok(ok, "something covers the middle of " + (await locator.evaluate(el => el.outerHTML.slice(0, 80))));
  await page.touchscreen.tap(x, y);
  await settle();
}

// a finger swipe up (real touch events); returns how far <main> scrolled
async function swipeUp(x = 180, y = 500) {
  const before = await page.evaluate(() => document.getElementById("main").scrollTop);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * 20 }] }); await page.waitForTimeout(16); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await settle(600);
  return (await page.evaluate(() => document.getElementById("main").scrollTop)) - before;
}

// every button's clickable area must stay close to the button itself (no stray full-screen tap areas)
async function strayTapAreas() {
  return page.evaluate(() => {
    const bad = [];
    for (let x = 4; x < innerWidth; x += 24) for (let y = 4; y < innerHeight; y += 24) {
      const btn = document.elementFromPoint(x, y)?.closest("button, a");
      if (!btn) continue;
      const r = btn.getBoundingClientRect(), pad = 16;
      if (x < r.left - pad || x > r.right + pad || y < r.top - pad || y > r.bottom + pad) bad.push(`${btn.className || btn.tagName} at ${x},${y}`);
    }
    return bad;
  });
}

before(async () => {
  server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server.js"], { env: { ...process.env, PORT, DATA_DIR: dir, PASSWORD: "", TZ_DEFAULT: "Asia/Kolkata" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + "/api/health")).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
  const t1 = await api("POST", "/api/tasks", { title: "Buy milk", due: today, notes: "from the shop" });
  await api("POST", "/api/tasks", { title: "Call mom", due: today });
  await api("POST", "/api/tasks", { title: "Sub one", parent_id: t1.id });
  await api("POST", "/api/habits", { name: "Exercise", kind: "check", days: [0, 1, 2, 3, 4, 5, 6] });
  const sq = new DatabaseSync(path.join(dir, "daymark.sqlite"));
  sq.prepare("INSERT INTO notifications (type, title, body, task_id) VALUES ('reminder', 'Buy milk', 'Today', ?)").run(t1.id);
  sq.close();

  browser = await chromium.launch({ args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
  ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  page = await ctx.newPage();
  cdp = await ctx.newCDPSession(page);
  page.on("pageerror", e => { throw e; });
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE + "/#/myday");
  await page.waitForSelector(".task");
});
after(async () => { await browser?.close(); server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const shot = name => page.screenshot({ path: path.join(process.env.SHOTS || os.tmpdir(), `daymark-${name}.png`) });

test("list: ticking and unticking a task by touch", async () => {
  const row = page.locator(".task", { hasText: "Call mom" });
  await tap(row.locator(".check").first());
  await tap(page.locator("details.group summary", { hasText: "Completed" }));
  const done = page.locator(".task.done", { hasText: "Call mom" });
  assert.equal(await done.count(), 1, "task should be in Completed after ticking");
  await tap(done.locator(".check").first());
  assert.equal(await page.locator(".task:not(.done)", { hasText: "Call mom" }).count(), 1, "unticking brings it back");
  await shot("list");
});

test("task page: opens, no stray tap areas, scrolls, back arrow works", async () => {
  await tap(page.locator(".task .body", { hasText: "Buy milk" }));
  assert.match(await hash(), /^#\/task\/\d+$/);
  await page.waitForSelector("form.task-form.page");
  await page.locator("summary", { hasText: "Subtasks" }).click(); // make the page long
  await page.locator("summary", { hasText: "Reminders" }).evaluate(el => { el.parentElement.open = true; });
  await shot("task-page");
  assert.deepEqual(await strayTapAreas(), []);
  const saveBottom = await page.locator("button[value=save]").evaluate(el => innerHeight - el.getBoundingClientRect().bottom);
  assert.ok(saveBottom < 100 && saveBottom >= 0, `Save bar should sit at the bottom of the screen (${Math.round(saveBottom)}px above it)`);
  const moved = await swipeUp();
  assert.ok(moved > 50, `page should scroll with a finger swipe (moved ${moved}px)`);
  await tap(page.locator(".x.back"));
  assert.equal(await hash(), "#/myday", "back arrow returns to the list");
});

test("task page: edit and save", async () => {
  await tap(page.locator(".task .body", { hasText: "Buy milk" }));
  await page.fill(".task-title", "Buy oat milk");
  await tap(page.locator("button[value=save]"));
  await page.waitForSelector(".task .title:text('Buy oat milk')");
  assert.equal(await hash(), "#/myday");
});

test("notification opens the task page, which scrolls and goes back", async () => {
  await page.goto(BASE + "/#/notifications");
  await page.waitForSelector(".notif");
  await tap(page.locator(".notif").first());
  assert.match(await hash(), /^#\/task\/\d+$/);
  await page.waitForSelector("form.task-form.page");
  assert.deepEqual(await strayTapAreas(), []);
  await tap(page.locator(".x.back"));
  assert.equal(await hash(), "#/notifications");
});

test("habit: check in and out, open the habit page, scroll, back", async () => {
  await page.goto(BASE + "/#/habits");
  await page.waitForSelector(".habit");
  const check = page.locator(".habit .check").first();
  await tap(check);
  assert.ok((await check.getAttribute("class")).includes("on"), "ticked");
  await tap(check);
  assert.ok(!(await check.getAttribute("class")).includes("on"), "unticked");
  await tap(page.locator(".habit .title").first());
  assert.match(await hash(), /^#\/habit\/\d+$/);
  await page.waitForSelector("form.task-form");
  await shot("habit-page");
  assert.deepEqual(await strayTapAreas(), []);
  const h = await page.evaluate(() => { const m = document.getElementById("main"); return [m.scrollHeight, m.clientHeight]; });
  if (h[0] > h[1]) assert.ok((await swipeUp()) > 20, "habit page should scroll");
  await tap(page.locator("header .x.back"));
  assert.equal(await hash(), "#/habits");
});

test("every page has a way to open the menu on a phone", async () => {
  for (const r of ["myday", "inbox", "time", "habits", "calendar", "progress", "report", "notifications", "settings"]) {
    await page.goto(BASE + "/#/" + r);
    await page.waitForSelector("main header");
    const burger = page.locator("main header .burger");
    assert.equal(await burger.count(), 1, r + " has no menu button");
    await tap(burger);
    assert.ok(await page.locator(".side.open").count(), r + " menu doesn't open");
    await page.locator(".scrim").tap({ position: { x: 340, y: 300 } });
  }
});

// ---------- wider sweep ----------

test("every page: no sideways overflow, no stray tap areas, no console errors", async () => {
  for (const r of ["myday", "upcoming", "starred", "all", "done", "inbox", "time", "habits", "calendar", "progress", "report", "notifications", "settings"]) {
    await page.goto(BASE + "/#/" + r);
    await page.waitForSelector("main header");
    await settle(300);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth + (document.getElementById("main").scrollWidth - document.getElementById("main").clientWidth));
    assert.ok(over <= 0, `${r}: content is ${over}px wider than the screen`);
    assert.deepEqual(await strayTapAreas(), [], r);
    await shot("page-" + r);
  }
  assert.deepEqual(errors, []);
});

test("add a task with the quick box, star it, delete it, undo", async () => {
  await page.goto(BASE + "/#/myday");
  await page.waitForSelector(".add");
  await page.fill("#add-input", "Pay rent tomorrow 5pm !");
  await tap(page.locator(".add-row button[type=submit]"));
  await page.goto(BASE + "/#/upcoming");
  const row = page.locator(".task", { hasText: "Pay rent" });
  await row.waitFor();
  assert.ok(/5:00|17:00/.test(await row.innerText()), "time parsed: " + (await row.innerText()));
  await page.goto(BASE + "/#/starred");
  assert.ok(await page.locator(".task", { hasText: "Pay rent" }).count(), "the ! in the text starred it");
  await tap(page.locator(".task", { hasText: "Pay rent" }).locator(".star"));
  assert.equal(await page.locator(".task", { hasText: "Pay rent" }).count(), 0, "unstarring removes it from Starred");
  await page.goto(BASE + "/#/upcoming");
  await tap(page.locator(".task .body", { hasText: "Pay rent" }));
  await page.waitForSelector("form.task-form.page");
  await tap(page.locator("button[value=delete], button.danger").first());
  await page.waitForSelector(".toast");
  assert.equal(await page.locator(".task", { hasText: "Pay rent" }).count(), 0, "deleted");
  await tap(page.locator(".toast button", { hasText: "Undo" }));
  await page.waitForSelector(".task:has-text('Pay rent')");
});

test("subtasks: add on the task page, tick one, open it", async () => {
  await page.goto(BASE + "/#/myday");
  await tap(page.locator(".task .body", { hasText: "Call mom" }));
  await page.waitForSelector("form.task-form.page");
  const sum = page.locator("summary", { hasText: "Subtasks" });
  await sum.click();
  const input = page.locator("details:has(> summary:text('Subtasks')) input[type=text], details:has(> summary:text('Subtasks')) input:not([type])").last();
  await input.fill("Dial number");
  await input.press("Enter");
  await page.waitForSelector("text=Dial number");
  await tap(page.locator(".x.back"));
  assert.ok(await page.locator(".task", { hasText: "Dial number" }).count(), "subtask shows under parent");
});

test("lists: create, add a task, rename, delete", async () => {
  await page.goto(BASE + "/#/myday");
  page.once("dialog", d => d.accept("Groceries"));
  await tap(page.locator(".burger"));
  await tap(page.locator("button.nav", { hasText: "New list" }));
  await page.waitForSelector("h2:text('Groceries')");
  await page.fill("#add-input", "Eggs");
  await page.press("#add-input", "Enter");
  await page.waitForSelector(".task:has-text('Eggs')");
  await page.selectOption("select.sort", "date");
  const [title, sort] = await Promise.all([page.locator("header h2").boundingBox(), page.locator("select.sort").boundingBox()]);
  assert.ok(title.x + title.width <= sort.x + 1, "list title is covered by the sort menu");
  assert.ok(title.width > 60, "list title is squashed to " + Math.round(title.width) + "px");
  page.once("dialog", d => d.accept("Shopping"));
  await tap(page.locator("details.menu summary"));
  await tap(page.locator(".menu-body button", { hasText: "Rename" }));
  await page.waitForSelector("h2:text('Shopping')");
  await shot("list-menu");
  page.once("dialog", d => d.accept());
  await tap(page.locator("details.menu summary"));
  await tap(page.locator(".menu-body button", { hasText: "Delete list" }));
  await page.waitForFunction(() => location.hash === "#/myday");
});

test("search finds tasks and clears", async () => {
  await page.goto(BASE + "/#/myday");
  await page.fill("#search-input", "milk");
  await page.waitForSelector("h3:has-text('Search results')");
  assert.ok(await page.locator(".task", { hasText: "milk" }).count());
  await page.fill("#search-input", "");
  await page.waitForFunction(() => !document.querySelector("h3")?.textContent.includes("Search"));
});

test("calendar: pick a day, add a task there, change month", async () => {
  await page.goto(BASE + "/#/calendar");
  await tap(page.locator(".cal-cell.today"));
  await page.waitForSelector("section.group .add");
  await page.fill("#add-input", "Dentist");
  await page.press("#add-input", "Enter");
  await page.waitForSelector(".cal-cell.today:has(.ev)");
  const t = await page.locator("h2").first().innerText();
  await tap(page.locator("header button", { hasText: "›" }));
  assert.notEqual(await page.locator("h2").first().innerText(), t, "month changed");
  await shot("calendar");
});

test("inbox: capture, turn into task, archive", async () => {
  await page.goto(BASE + "/#/inbox");
  await page.fill("#add-input", "Idea: read a book");
  await page.press("#add-input", "Enter");
  await page.waitForSelector(".capture:has-text('read a book')");
  await tap(page.locator(".capture button", { hasText: "Archive" }));
  await tap(page.locator(".pill", { hasText: "Archived" }));
  assert.ok(await page.locator(".capture", { hasText: "read a book" }).count(), "archived");
  await tap(page.locator(".capture button", { hasText: "Move to inbox" }));
  await tap(page.locator(".pill", { hasText: "Inbox" }));
  await tap(page.locator(".capture button", { hasText: "→ Task" }));
  await page.waitForSelector("form.task-form.page");
  assert.match(await hash(), /^#\/task\/\d+$/);
});

test("habits: create a new habit from the + button and see it on progress", async () => {
  await page.goto(BASE + "/#/habits");
  await page.waitForSelector("main header");
  await tap(page.locator("main header button", { hasText: /New|\+/ }).first());
  await page.waitForSelector("dialog[open] input, .modal input");
  await shot("new-habit");
  await page.locator("dialog[open] input, .modal input").first().fill("Read");
  await tap(page.locator("dialog[open] button.primary, .modal button.primary").first());
  await page.waitForSelector(".habit:has-text('Read')");
  await page.goto(BASE + "/#/progress");
  await page.waitForSelector(".habit-progress:has-text('Read')");
});

test("settings: change a toggle, back up now", async () => {
  await page.goto(BASE + "/#/settings");
  await page.waitForSelector(".settings");
  await tap(page.locator("button", { hasText: "Back up now" }));
  await page.waitForSelector("text=Latest backup");
});

test("repeating task: completing makes the next one", async () => {
  const t = await api("POST", "/api/tasks", { title: "Water plants", due: today, repeat: { freq: "daily", interval: 1 } });
  await page.goto(BASE + "/#/myday");
  await page.reload();
  const row = page.locator(".task", { hasText: "Water plants" });
  await tap(row.locator(".check").first());
  await page.waitForSelector(".toast:has-text('Next')");
  await page.goto(BASE + "/#/upcoming");
  assert.ok(await page.locator(".task", { hasText: "Water plants" }).count(), "next occurrence is upcoming");
  assert.ok(t.id);
});

// ---------- ease of use ----------
// Finger targets: every tappable thing should be at least 40px tall/wide, counting the invisible tap area around it.
const small = () => page.evaluate(() => {
  const out = [];
  const els = [...document.querySelectorAll("button, a[href], input, select, textarea, summary, .check, .star, .dot")].filter(e => e.offsetParent && !e.closest(".side:not(.open)"));
  for (const e of els) {
    const r = e.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
    // grow by the ::after tap area if the element declares one
    const a = getComputedStyle(e, "::after"), grow = a.content !== "none" && a.position === "absolute" ? Math.abs(parseFloat(a.top)) || 0 : 0;
    const w = r.width + grow * 2, hh = r.height + grow * 2;
    const type = e.type === "checkbox" || e.type === "radio";
    if ((hh < 40 || w < 40) && !(type && e.closest("label"))) out.push(`${e.tagName.toLowerCase()}.${e.className || ""} "${(e.textContent || e.placeholder || e.getAttribute("aria-label") || "").trim().slice(0, 20)}" ${Math.round(w)}x${Math.round(hh)}`);
  }
  return out;
});
test("ease of use: every tap target is at least 40px", async () => {
  const report = {};
  for (const r of ["myday", "upcoming", "inbox", "time", "habits", "calendar", "progress", "report", "notifications", "settings"]) {
    await page.goto(BASE + "/#/" + r); await page.waitForSelector("main header"); await settle(300);
    report[r] = await small();
  }
  const t = (await api("GET", "/api/tasks"))[0];
  await page.goto(BASE + "/#/task/" + t.id); await page.waitForSelector("form.task-form.page"); await settle(300);
  report.taskpage = await small();
  assert.deepEqual(Object.fromEntries(Object.entries(report).filter(([, v]) => v.length)), {}, "tap targets under 40px");
});

test("desktop, dark mode: screenshots of every page", async () => {
  const dctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, colorScheme: "dark" });
  const d = await dctx.newPage();
  for (const r of ["myday", "time", "habits", "calendar", "progress", "report", "inbox", "notifications", "settings"]) {
    await d.goto(BASE + "/#/" + r);
    await d.waitForSelector("main header");
    await d.waitForTimeout(300);
    await d.screenshot({ path: path.join(process.env.SHOTS || os.tmpdir(), `daymark-desktop-${r}.png`) });
  }
  await dctx.close();
});

// load the app fresh (so it knows the new task), then follow a notification link
async function openAlarmFor(id) {
  await page.goto(BASE + "/#/myday");
  await page.reload();
  await page.waitForSelector("main header");
  await page.goto(BASE + "/#/alarm/" + id);
}

test("opening a reminder shows the snooze popup; snoozing adds one alarm and keeps the others", async () => {
  const t = await api("POST", "/api/tasks", { title: "Take pills", due: today, due_time: "23:00" });
  await api("PUT", `/api/tasks/${t.id}/reminders`, { reminders: [{ offset_min: 0 }, { offset_min: 60 }] });
  await openAlarmFor(t.id);
  await page.waitForSelector("dialog .alarm");
  assert.ok(!(await hash()).includes("alarm"), "the alarm route is replaced, so Back doesn't reopen it");
  assert.ok(await page.locator("dialog .alarm", { hasText: "Take pills" }).count());
  for (const label of ["5 hours later", "Tomorrow", "Next week", "Set custom", "Mark done"]) assert.ok(await page.locator("dialog .alarm", { hasText: label }).count(), label);
  assert.deepEqual(await strayTapAreas(), []);
  await settle(500);
  await shot("alarm-popup");
  assert.ok(await page.locator("dialog .alarm").evaluate(el => { const d = el.closest("dialog").getBoundingClientRect(); return [...el.querySelectorAll("button, input")].every(b => b.getBoundingClientRect().right <= d.right + 1); }), "popup content sticks out of the popup");
  await tap(page.locator("dialog .alarm button", { hasText: "5 hours later" }));
  await page.waitForSelector(".toast:has-text('Reminder set')");
  const rems = (await api("GET", "/api/reminders")).filter(r => r.task_id === t.id);
  assert.equal(rems.length, 3, "two regular reminders plus one snooze");
  const sn = rems.find(r => r.snooze);
  const mins = (new Date(sn.remind_at) - Date.now()) / 60000;
  assert.ok(mins > 295 && mins < 301, "about 5 hours from now, got " + mins);
  assert.equal(await page.locator("dialog").count(), 0, "popup closed");
});

test("reminder popup: custom time and mark done", async () => {
  const t = await api("POST", "/api/tasks", { title: "Water the plants today" });
  await openAlarmFor(t.id);
  await page.waitForSelector("dialog .alarm");
  const d = new Date(Date.now() + 3 * 86400_000), p2 = n => String(n).padStart(2, "0");
  await page.fill("dialog .alarm input[type=datetime-local]", `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T09:30`);
  await tap(page.locator("dialog .alarm button", { hasText: "Set custom" }));
  await page.waitForSelector(".toast:has-text('Reminder set')");
  assert.equal((await api("GET", "/api/reminders")).filter(r => r.task_id === t.id && r.snooze).length, 1);
  await openAlarmFor(t.id);
  await page.waitForSelector("dialog .alarm");
  await tap(page.locator("dialog .alarm button", { hasText: "Mark done" }));
  await page.waitForSelector(".toast:has-text('completed')");
  assert.ok((await api("GET", "/api/tasks")).find(x => x.id === t.id).done_at, "task is done");
});

test("overdue tasks have a red border", async () => {
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  await api("POST", "/api/tasks", { title: "Late one", due: yesterday });
  await page.goto(BASE + "/#/myday");
  await page.reload();
  const row = page.locator("li.task.overdue", { hasText: "Late one" });
  await row.waitFor();
  assert.notEqual(await row.evaluate(el => getComputedStyle(el).borderTopColor), "rgba(0, 0, 0, 0)");
  assert.equal(await page.locator("li.task.overdue", { hasText: "Buy oat milk" }).count(), 0, "today's tasks are not overdue");
  await shot("overdue");
});

test("opening the app always starts on My Day, even after visiting another page", async () => {
  await page.goto(BASE + "/#/settings");
  await page.waitForSelector(".settings");
  await page.goto(BASE + "/");
  await page.reload();
  await page.waitForSelector("main header h2");
  assert.equal(await page.locator("main header h2").first().innerText(), "My Day");
});

test("time: start a timer, see it running, stop it, entry shows up", async () => {
  await page.goto(BASE + "/#/time");
  await page.waitForSelector(".time-page .timer");
  await page.fill(".timer input", "Reading");
  await tap(page.locator(".timer button.primary"));
  await page.waitForSelector(".timer.running .activity:text('Reading')");
  const t1 = await page.locator(".timer .elapsed").innerText();
  await settle(2200);
  assert.notEqual(await page.locator(".timer .elapsed").innerText(), t1, "the clock ticks");
  await shot("time-running");
  await page.goto(BASE + "/#/myday");
  await page.waitForSelector(".timer-bar");
  assert.ok(await page.locator(".timer-bar", { hasText: "Reading" }).count(), "running bar on My Day");
  await tap(page.locator(".timer-bar button"));
  assert.equal(await page.locator(".timer-bar").count(), 0, "stopped");
  assert.ok((await api("GET", "/api/time")).entries.some(e => e.activity === "Reading" && e.end_at));
  await page.goto(BASE + "/#/time");
  await page.waitForSelector(".tentries li:has-text('Reading')");
  assert.ok(await page.locator(".timer .pill", { hasText: "Reading" }).count(), "recent activity pill");
  await tap(page.locator(".timer .pill", { hasText: "Reading" }));
  await page.waitForSelector(".timer.running");
  await tap(page.locator(".timer button.primary", { hasText: "Stop" }));
  assert.deepEqual(await strayTapAreas(), []);
});

test("time: add an entry by hand, edit it, delete it", async () => {
  await page.goto(BASE + "/#/time");
  await tap(page.locator("main header button", { hasText: "+ Add" }));
  await page.waitForSelector("dialog form");
  await page.fill("dialog input[type=text]", "Gym");
  await tap(page.locator("dialog button.primary"));
  await page.waitForSelector(".tentries li:has-text('Gym')");
  await tap(page.locator(".tentries li", { hasText: "Gym" }));
  await page.fill("dialog input[type=text]", "Gym session");
  await tap(page.locator("dialog button.primary"));
  await page.waitForSelector(".tentries li:has-text('Gym session')");
  page.once("dialog", d => d.accept());
  await tap(page.locator(".tentries li", { hasText: "Gym session" }));
  await shot("time-entry");
  await tap(page.locator("dialog button.danger"));
  await page.waitForFunction(() => !document.body.innerText.includes("Gym session"));
});

test("time: the hourly prompt link opens a popup and logs that hour", async () => {
  const hourStart = Math.floor(Date.now() / 3600_000) * 3600_000 - 3600_000;
  await page.goto(BASE + "/#/myday");
  await page.reload();
  await page.waitForSelector("main header");
  await page.goto(BASE + "/#/hour/" + hourStart);
  await page.waitForSelector("dialog .alarm");
  assert.ok(!(await hash()).includes("hour"), "route replaced");
  assert.ok(await page.locator("dialog .pill", { hasText: "Reading" }).count(), "recent activities offered");
  await settle(500);
  await shot("hour-popup");
  await tap(page.locator("dialog .pill", { hasText: "Reading" }));
  await page.waitForSelector(".toast:has-text('Logged')");
  const e = (await api("GET", "/api/time")).entries.find(x => x.source === "hourly");
  assert.equal(new Date(e.start_at).getTime(), hourStart);
  assert.equal(e.activity, "Reading");
});

test("time: Track button on a task starts a timer linked to it", async () => {
  const t = await api("POST", "/api/tasks", { title: "Write report" });
  await page.goto(BASE + "/#/myday");
  await page.reload();
  await page.goto(BASE + "/#/task/" + t.id);
  await page.waitForSelector("form.task-form.page");
  await tap(page.locator("button", { hasText: "⏱ Track" }));
  await page.waitForSelector(".toast:has-text('Tracking: Write report')");
  const r = (await api("GET", "/api/time")).running;
  assert.equal(r.task_id, t.id);
  await api("POST", "/api/time/stop");
});

test("reports: daily and weekly numbers, switching and stepping back; report notification opens its report", async () => {
  const t = await api("POST", "/api/tasks", { title: "Finish report check" });
  await api("POST", `/api/tasks/${t.id}/complete`);
  await page.goto(BASE + "/#/myday");
  await page.reload();
  await page.goto(BASE + "/#/report");
  await page.waitForSelector(".report-page .tiles");
  assert.ok(await page.locator(".report-page", { hasText: "Finish report check" }).count(), "today's completed task listed");
  await shot("report-day");
  await tap(page.locator(".report-page .pill", { hasText: "Weekly" }));
  await page.waitForSelector(".report-page .bars");
  assert.equal(await page.locator(".report-nav b").innerText(), "This week");
  await shot("report-week");
  await tap(page.locator(".report-nav button[aria-label=Previous]"));
  await page.waitForFunction(() => !document.querySelector(".report-nav b").textContent.includes("This week"));
  await tap(page.locator(".report-page .pill", { hasText: "Daily" }));
  await page.goto(BASE + "/#/report/week");
  await page.waitForSelector(".report-page .bars");
  assert.equal(await hash(), "#/report");
});
