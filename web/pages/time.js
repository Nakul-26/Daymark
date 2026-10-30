// Time tracking: a timer, an hourly "what did you do?" log, today's entries, and a weekly summary.
// An entry is what actually happened; it can be linked to a task, but it is not the task's deadline or reminder.
import { h, modal, confirmBox } from "../ui.js";
import { state, render, pref } from "../state.js";
import { actions } from "../actions.js";
import { isoDay, addDays, dayOf, shortDate } from "../time.js";

const HOUR = 3600_000;
export const fmtDur = ms => { const m = Math.round(ms / 60000); return m < 1 ? "<1m" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
const fmtClock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, "0")).join(":"); };
const clockOf = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const hourOf = t => new Date(t).toLocaleTimeString([], { hour: "numeric" });
const startMs = e => new Date(e.start_at).getTime();
const endMs = e => (e.end_at ? new Date(e.end_at).getTime() : Date.now());
const durOf = e => endMs(e) - startMs(e);
const entries = () => state.time.entries;

// the running timer ticks on its own, without redrawing the page
setInterval(() => document.querySelectorAll("[data-elapsed]").forEach(el => { el.textContent = fmtClock(Date.now() - Number(el.dataset.elapsed)); }), 1000);

// most used activities first (ties: most recent)
export function recentActivities(n = 6) {
  const m = new Map();
  for (const e of entries()) { const c = m.get(e.activity) ?? { name: e.activity, n: 0, last: 0 }; c.n++; c.last = Math.max(c.last, startMs(e)); m.set(e.activity, c); }
  return [...m.values()].sort((a, b) => b.n - a.n || b.last - a.last).slice(0, n).map(c => c.name);
}

const activityPills = (onPick) => recentActivities().map(a => h("button", { type: "button", class: "pill", onclick: () => onPick(a) }, a));

// ---------- the popup for the hourly prompt (also opened from the "unlogged hours" list) ----------
export function openHourLog(start) {
  modal(close => {
    const save = a => { a = a.trim(); if (a) { close(); actions.timeHour(start, a); } };
    const input = h("input", { type: "text", placeholder: "Something else…", maxlength: 120, "aria-label": "Activity" });
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); save(input.value); } });
    const pills = activityPills(save);
    return h("div", { class: "task-form alarm" },
      h("h3", {}, `What did you do ${hourOf(start)}–${hourOf(start + HOUR)}?`),
      pills.length > 0 && h("div", { class: "pills" }, pills),
      h("div", { class: "row" }, input, h("button", { type: "button", class: "primary", onclick: () => save(input.value) }, "Save")),
      h("div", { class: "row actions" }, h("span", { class: "grow" }), h("button", { type: "button", onclick: close }, "Skip")));
  });
}

// ---------- add / edit one entry ----------
const toInput = t => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
export function editEntry(e = null) {
  modal(close => {
    const now = Date.now();
    const activity = h("input", { type: "text", maxlength: 120, value: e?.activity ?? "", list: "recent-activities", placeholder: "What did you do?", required: true });
    const start = h("input", { type: "datetime-local", value: toInput(e ? startMs(e) : now - HOUR), required: true });
    const end = h("input", { type: "datetime-local", value: e ? (e.end_at ? toInput(endMs(e)) : "") : toInput(now) });
    return h("form", { class: "task-form", onsubmit: ev => {
      ev.preventDefault();
      const p = { activity: activity.value, start_at: new Date(start.value).toISOString(), end_at: end.value ? new Date(end.value).toISOString() : null };
      close();
      e ? actions.timeEdit(e.id, p) : actions.timeAdd(p);
    } },
      h("h3", {}, e ? "Edit entry" : "Add time"),
      h("datalist", { id: "recent-activities" }, recentActivities(12).map(a => h("option", { value: a }))),
      h("label", {}, "Activity", activity),
      h("div", { class: "grid2" }, h("label", {}, "Start", start), h("label", {}, e && !e.end_at ? "End (empty = still running)" : "End", end)),
      h("div", { class: "row actions" },
        e && h("button", { type: "button", class: "danger", onclick: () => { if (confirmBox("Delete this entry?")) { close(); actions.timeDelete(e.id); } } }, "Delete"),
        h("span", { class: "grow" }), h("button", { type: "button", onclick: close }, "Cancel"), h("button", { class: "primary" }, "Save")));
  });
}

// ---------- pieces ----------
// Small bar for other pages: shows the running timer with a Stop button.
export function runningBar() {
  const r = state.time.running;
  if (!r) return null;
  return h("div", { class: "timer-bar" },
    h("a", { href: "#/time", class: "grow" }, h("span", { class: "dot-live" }), h("b", {}, r.activity), " ", h("span", { class: "elapsed", "data-elapsed": startMs(r) }, fmtClock(Date.now() - startMs(r)))),
    h("button", { onclick: () => actions.timeStop() }, "■ Stop"));
}

function timerCard() {
  const r = state.time.running;
  if (r) {
    const task = r.task_id && state.tasks.find(t => t.id === r.task_id);
    return h("section", { class: "group timer running" },
      h("h3", {}, "Tracking now"),
      h("div", { class: "activity" }, r.activity),
      task && h("a", { class: "muted", href: "#/task/" + task.id }, "↳ " + task.title),
      h("div", { class: "elapsed", "data-elapsed": startMs(r) }, fmtClock(Date.now() - startMs(r))),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => actions.timeStop() }, "■ Stop"), h("button", { onclick: () => editEntry(r) }, "Edit")));
  }
  const input = h("input", { type: "text", placeholder: "What are you working on?", maxlength: 120, "aria-label": "Activity" });
  const go = a => { a = a.trim(); if (a) actions.timeStart(a); };
  return h("section", { class: "group timer" },
    h("h3", {}, "Start a timer"),
    h("form", { class: "row", onsubmit: e => { e.preventDefault(); go(input.value); } }, input, h("button", { class: "primary" }, "▶ Start")),
    recentActivities().length > 0 && h("div", { class: "pills" }, activityPills(go)));
}

const totalsBy = list => {
  const m = new Map();
  for (const e of list) m.set(e.activity, (m.get(e.activity) ?? 0) + durOf(e));
  return [...m].sort((a, b) => b[1] - a[1]);
};
const bars = rows => {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return h("ul", { class: "tbars" }, rows.map(([name, ms]) => h("li", {}, h("div", { class: "tbar-top" }, h("span", {}, name), h("b", {}, fmtDur(ms))), h("div", { class: "tbar" }, h("i", { style: `width:${Math.round(ms / max * 100)}%` })))));
};

// Past hours today inside the prompt window that have (almost) nothing logged.
export function unloggedHours(now = Date.now()) {
  const from = Number((state.settings.time_prompt_from || "08:00").slice(0, 2)), to = Number((state.settings.time_prompt_to || "22:00").slice(0, 2));
  const out = [];
  for (let hr = from; hr < to; hr++) {
    const d = new Date(now); d.setHours(hr, 0, 0, 0);
    const s = d.getTime(), e = s + HOUR;
    if (e > now) break;
    const got = entries().reduce((sum, x) => sum + Math.max(0, Math.min(endMs(x), e) - Math.max(startMs(x), s)), 0);
    if (got < 0.5 * HOUR) out.push(s);
  }
  return out;
}

function todayView() {
  const today = isoDay(), mine = entries().filter(e => dayOf(e.start_at) === today);
  const unlogged = unloggedHours();
  const total = mine.reduce((s, e) => s + durOf(e), 0);
  return [
    h("section", { class: "group" }, h("h3", {}, `Today · ${fmtDur(total)} tracked`),
      mine.length ? bars(totalsBy(mine)) : h("p", { class: "muted" }, "Nothing tracked yet today.")),
    unlogged.length > 0 && h("section", { class: "group" }, h("h3", {}, `Unlogged hours (${unlogged.length})`),
      h("div", { class: "pills" }, unlogged.map(s => h("button", { class: "pill", onclick: () => openHourLog(s) }, `${hourOf(s)}–${hourOf(s + HOUR)}`)))),
    mine.length > 0 && h("section", { class: "group" }, h("h3", {}, "Entries"),
      h("ul", { class: "tentries" }, mine.map(e => h("li", { onclick: () => editEntry(e) },
        h("span", { class: "when" }, `${clockOf(startMs(e))}${e.end_at ? "–" + clockOf(endMs(e)) : " – now"}`),
        h("span", { class: "what" }, e.activity, e.source === "hourly" && h("small", { class: "muted" }, " · hourly")),
        h("b", {}, fmtDur(durOf(e))))))),
  ];
}

function weekView() {
  const today = isoDay(), days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const per = new Map(days.map(d => [d, 0]));
  const week = entries().filter(e => per.has(dayOf(e.start_at)));
  for (const e of week) per.set(dayOf(e.start_at), per.get(dayOf(e.start_at)) + durOf(e));
  const max = Math.max(1, ...per.values());
  return [
    h("section", { class: "group" }, h("h3", {}, `Last 7 days · ${fmtDur([...per.values()].reduce((a, b) => a + b, 0))}`),
      h("div", { class: "bars" }, days.map(d => h("div", { class: "barcol", title: `${shortDate(d)}: ${fmtDur(per.get(d))}` },
        h("div", { class: "barfill", style: `height:${Math.round(per.get(d) / max * 100)}%` }), h("span", {}, d.slice(8)))))),
    h("section", { class: "group" }, h("h3", {}, "By activity"), week.length ? bars(totalsBy(week)) : h("p", { class: "muted" }, "Nothing tracked this week.")),
  ];
}

export function renderTime() {
  const tab = pref.get("timeTab", "today");
  return h("div", { class: "time-page" },
    h("header", {},
      h("button", { class: "burger", "aria-label": "Menu", onclick: () => { state.menu = !state.menu; render(); } }, "☰"),
      h("h2", { class: "grow" }, "Time"),
      h("button", { onclick: () => editEntry() }, "+ Add")),
    timerCard(),
    h("div", { class: "pills" }, [["today", "Today"], ["week", "Week"]].map(([k, l]) => h("button", { class: "pill" + (tab === k ? " on" : ""), onclick: () => { pref.set("timeTab", k); render(); } }, l))),
    ...(tab === "week" ? weekView() : todayView()).filter(Boolean));
}
