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
// Pick one or more things and give each its minutes; they fill the hour in order.
export function openHourLog(start) {
  modal(close => {
    const rows = []; // { activity, minutes }
    const left = () => 60 - rows.reduce((s, r) => s + r.minutes, 0);
    const list = h("ul", { class: "hour-rows" }), status = h("small", { class: "muted" });
    // what you intend to do in the hour after this one (only offered while that hour is still under way or ahead)
    const next = start + HOUR, canPlan = next + HOUR > Date.now();
    const before = state.time.plans.find(p => p.hour_start === next)?.activity ?? "";
    const plan = h("input", { type: "text", placeholder: "e.g. Study, emails… (optional)", maxlength: 120, value: before, list: "recent-activities", "aria-label": "Next hour" });
    const planChanged = () => canPlan && plan.value.trim() !== before;
    const save = async () => {
      close();
      if (rows.length) await actions.timeHour(start, rows.map(r => ({ activity: r.activity, minutes: r.minutes })));
      if (planChanged()) await actions.timePlan(next, plan.value);
    };
    const saveBtn = h("button", { type: "button", class: "primary", onclick: save }, "Save");
    const input = h("input", { type: "text", placeholder: "Add something else…", maxlength: 120, "aria-label": "Activity" });
    const add = a => {
      a = a.trim(); if (!a) return;
      if (rows.length < 8) {
        let minutes = left();
        if (minutes <= 0 && rows.length) { // the hour is full: split the last thing in half with the new one
          const last = rows[rows.length - 1]; minutes = Math.floor(last.minutes / 2); last.minutes -= minutes;
        }
        rows.push({ activity: a, minutes: Math.max(1, minutes) });
      }
      input.value = ""; draw();
    };
    const draw = () => {
      list.replaceChildren(...rows.map((r, i) => h("li", {},
        h("span", { class: "grow" }, r.activity),
        h("input", { type: "number", min: 1, max: 60, value: r.minutes, "aria-label": `Minutes for ${r.activity}`, onchange: e => { r.minutes = Math.min(60, Math.max(1, Math.round(+e.target.value) || 1)); draw(); } }),
        h("span", { class: "muted" }, "min"),
        h("button", { type: "button", class: "x", "aria-label": "Remove " + r.activity, onclick: () => { rows.splice(i, 1); draw(); } }, "×"))));
      status.textContent = !rows.length ? "Tap what you did. Add more than one to split the hour." : left() > 0 ? `${left()} min not logged` : left() < 0 ? `${-left()} min too many` : "The whole hour is logged";
      saveBtn.disabled = rows.length ? left() < 0 : !planChanged();
    };
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); add(input.value); } });
    plan.addEventListener("input", draw);
    draw();
    const planned = state.time.plans.find(p => p.hour_start === start)?.activity; // what you said you'd do in this hour
    return h("div", { class: "task-form alarm" },
      h("h3", {}, `What did you do ${hourOf(start)}–${hourOf(start + HOUR)}?`),
      h("div", { class: "pills" }, planned && h("button", { type: "button", class: "pill", onclick: () => add(planned) }, "📌 Planned: " + planned), activityPills(add)),
      h("div", { class: "row" }, input, h("button", { type: "button", onclick: () => add(input.value) }, "Add")),
      list, status,
      canPlan && h("label", { class: "next-hour" }, `Next hour, ${hourOf(next)}–${hourOf(next + HOUR)}: what will you do?`, plan),
      h("datalist", { id: "recent-activities" }, recentActivities(12).map(a => h("option", { value: a }))),
      h("div", { class: "row actions" }, h("span", { class: "grow" }), h("button", { type: "button", onclick: close }, "Skip"), saveBtn));
  });
}

// ---------- plan an hour ahead ----------
export function openPlan(hour) {
  modal(close => {
    const cur = state.time.plans.find(p => p.hour_start === hour)?.activity ?? "";
    const input = h("input", { type: "text", maxlength: 120, value: cur, list: "recent-activities", placeholder: "What will you do?", "aria-label": "Plan", required: true });
    return h("form", { class: "task-form", onsubmit: e => { e.preventDefault(); close(); actions.timePlan(hour, input.value); } },
      h("h3", {}, `Plan ${hourOf(hour)}–${hourOf(hour + HOUR)}`),
      h("datalist", { id: "recent-activities" }, recentActivities(12).map(a => h("option", { value: a }))),
      input, h("div", { class: "pills" }, activityPills(a => { input.value = a; })),
      h("div", { class: "row actions" },
        cur && h("button", { type: "button", class: "danger", onclick: () => { close(); actions.timePlan(hour, ""); } }, "Clear"),
        h("span", { class: "grow" }), h("button", { type: "button", onclick: close }, "Cancel"), h("button", { class: "primary" }, "Save")));
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
export function unloggedHours(now = Date.now()) { // pass the end of a past day to list that day's gaps
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

const SORTS = { new: "Newest first", old: "Oldest first", long: "Longest first", name: "By activity" };
const SORT_FNS = {
  new: (a, b) => startMs(b) - startMs(a), old: (a, b) => startMs(a) - startMs(b),
  long: (a, b) => durOf(b) - durOf(a), name: (a, b) => a.activity.localeCompare(b.activity) || startMs(a) - startMs(b),
};

// which day / week the Time page is looking at (resets to today when you leave the page)
const look = { day: null, weekEnd: null };
const OLDEST = () => addDays(isoDay(), -59); // the server keeps 60 days of entries
const dayLabel = d => (d === isoDay() ? "Today" : d === addDays(isoDay(), -1) ? "Yesterday" : shortDate(d));
// ‹ label › with a date picker; `step` is how many days one tap moves
const navBar = (label, value, step, onSet) => {
  const today = isoDay(), set = v => { onSet(v < OLDEST() ? OLDEST() : v > today ? today : v); render(); };
  return h("div", { class: "report-nav row" },
    h("button", { type: "button", "aria-label": "Earlier", disabled: value <= OLDEST(), onclick: () => set(addDays(value, -step)) }, "‹"),
    h("b", { class: "grow" }, label),
    h("input", { type: "date", "aria-label": "Pick a date", value, min: OLDEST(), max: today, onchange: e => e.target.value && set(e.target.value) }),
    h("button", { type: "button", "aria-label": "Later", disabled: value >= today, onclick: () => set(addDays(value, step)) }, "›"));
};

// the hour under way and the next ones, each with what you planned (tap to change)
function planSection() {
  const now = Date.now(), plans = state.time.plans.filter(p => p.hour_start + HOUR > now);
  const first = (() => { const d = new Date(now); d.setMinutes(0, 0, 0); return d.getTime(); })(); // local start of this hour
  return h("section", { class: "group" },
    h("div", { class: "row" }, h("h3", { class: "grow" }, "Planned"), h("button", { type: "button", onclick: () => openPlan(first + HOUR) }, "+ Next hour")),
    plans.length ? h("ul", { class: "tentries" }, plans.map(p => h("li", { onclick: () => openPlan(p.hour_start) },
      h("span", { class: "when" }, `${hourOf(p.hour_start)}–${hourOf(p.hour_start + HOUR)}`), h("span", { class: "what" }, p.activity)))) : h("p", { class: "muted" }, "Nothing planned. Plan the next hour, or answer the hourly prompt."));
}

function todayView() {
  const today = isoDay(), day = look.day && look.day <= today ? look.day : today, isToday = day === today;
  const mine = entries().filter(e => dayOf(e.start_at) === day);
  const unlogged = unloggedHours(isToday ? Date.now() : new Date(day + "T23:59:59").getTime()), sort = SORTS[pref.get("timeSort", "new")] ? pref.get("timeSort", "new") : "new";
  const total = mine.reduce((s, e) => s + durOf(e), 0);
  return [
    navBar(dayLabel(day), day, 1, v => { look.day = v; }),
    h("section", { class: "group" }, h("h3", {}, `${dayLabel(day)} · ${fmtDur(total)} tracked`),
      mine.length ? bars(totalsBy(mine)) : h("p", { class: "muted" }, isToday ? "Nothing tracked yet today." : "Nothing tracked this day.")),
    isToday && planSection(),
    unlogged.length > 0 && h("section", { class: "group" }, h("h3", {}, `Unlogged hours (${unlogged.length})`),
      h("div", { class: "pills" }, unlogged.map(s => h("button", { class: "pill", onclick: () => openHourLog(s) }, `${hourOf(s)}–${hourOf(s + HOUR)}`)))),
    mine.length > 0 && h("section", { class: "group" },
      h("div", { class: "row" }, h("h3", { class: "grow" }, "Entries"),
        h("select", { class: "sort", "aria-label": "Sort entries", onchange: e => { pref.set("timeSort", e.target.value); render(); } },
          Object.entries(SORTS).map(([k, label]) => h("option", { value: k, selected: sort === k }, label)))),
      h("ul", { class: "tentries" }, [...mine].sort(SORT_FNS[sort]).map(e => h("li", { onclick: () => editEntry(e) },
        h("span", { class: "when" }, `${clockOf(startMs(e))}${e.end_at ? "–" + clockOf(endMs(e)) : " – now"}`),
        h("span", { class: "what" }, e.activity, e.source === "hourly" && h("small", { class: "muted" }, " · hourly")),
        h("b", {}, fmtDur(durOf(e))))))),
  ];
}

function weekView() {
  const today = isoDay(), end = look.weekEnd && look.weekEnd <= today ? look.weekEnd : today;
  const days = Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
  const per = new Map(days.map(d => [d, 0]));
  const week = entries().filter(e => per.has(dayOf(e.start_at)));
  for (const e of week) per.set(dayOf(e.start_at), per.get(dayOf(e.start_at)) + durOf(e));
  const max = Math.max(1, ...per.values());
  return [
    navBar(end === today ? "Last 7 days" : `${shortDate(days[0])} – ${shortDate(end)}`, end, 7, v => { look.weekEnd = v; }),
    h("section", { class: "group" }, h("h3", {}, `${end === today ? "Last 7 days" : "7 days"} · ${fmtDur([...per.values()].reduce((a, b) => a + b, 0))}`),
      h("div", { class: "bars" }, days.map(d => h("div", { class: "barcol", style: "cursor:pointer", onclick: () => { look.day = d; pref.set("timeTab", "today"); render(); }, title: `${shortDate(d)}: ${fmtDur(per.get(d))}` },
        h("div", { class: "barfill", style: `height:${Math.round(per.get(d) / max * 100)}%` }), h("span", {}, d.slice(8)))))),
    h("section", { class: "group" }, h("h3", {}, "By activity"), week.length ? bars(totalsBy(week)) : h("p", { class: "muted" }, "Nothing tracked in these 7 days.")),
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
    h("div", { class: "pills" }, [["today", "Day"], ["week", "Week"]].map(([k, l]) => h("button", { class: "pill" + (tab === k ? " on" : ""), onclick: () => { pref.set("timeTab", k); render(); } }, l))),
    ...(tab === "week" ? weekView() : todayView()).filter(Boolean));
}
