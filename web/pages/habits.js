// Habits & goals page, plus habitRow() which My Day reuses for today's habits.
import { h, modal, num, confirmBox } from "../ui.js";
import { state, render, leavePage } from "../state.js";
import { actions } from "../actions.js";
import { isoDay, addDays, mondayOf, DOW, shortDate } from "../time.js";
import { makeTotals, scheduled, dayDone, weekProgress, streak, history } from "../habitstats.js";

export const openHabitPage = id => { location.hash = "#/habit/" + id; };
const unitText = h_ => (h_.kind === "amount" ? h_.unit || "" : "");

export const activeHabits = () => state.habits.filter(x => !x.archived_at);

function progressBar(p, unit) {
  if (p.target == null) return p.value ? h("span", { class: "muted" }, `${num(p.value)}${unit ? " " + unit : ""} this week`) : null;
  return h("div", { class: "progress", title: `${num(p.value)} of ${num(p.target)}` },
    h("div", { class: "bar" + (p.met ? " met" : ""), style: `width:${Math.round(p.pct * 100)}%` }),
    h("span", {}, `${num(p.value)}/${num(p.target)}${unit ? " " + unit : ""} this week`));
}

// day = the day being tracked (today in My Day)
export function habitRow(hb, { day = isoDay(), strip = false, page = false } = {}) {
  const totals = makeTotals(state.habitLogs);
  const today = isoDay();
  const total = totals(hb.id, day);
  const done = dayDone(hb, total);
  const p = weekProgress(hb, totals, day);
  const s = streak(hb, totals, today);

  let control;
  if (hb.kind === "check") {
    control = h("button", { class: "check" + (done ? " on" : ""), title: done ? "Undo" : "Mark done", onclick: () => actions.toggleHabit(hb, day) }, done ? "✓" : "");
  } else {
    const input = h("input", { type: "number", step: "any", min: 0, placeholder: hb.unit || "amount", class: "amount", "aria-label": "Amount" });
    const submit = () => { const v = Number(input.value); if (v > 0) actions.logHabit(hb, v, day); };
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    control = h("span", { class: "logger" }, input, h("button", { onclick: submit }, "Log"));
  }

  const li = h("li", { class: "habit" + (done ? " done" : "") },
    h("div", { class: "main" },
      hb.kind === "check" ? control : h("span", { class: "check" + (done ? " on" : ""), "aria-hidden": "true" }, done ? "✓" : ""),
      h("div", { class: "body" },
        h("div", { class: "title", onclick: page ? null : () => openHabitPage(hb.id) }, hb.name,
          hb.kind === "amount" && total ? h("span", { class: "chip" }, `${num(total)} ${unitText(hb)} ${day === today ? "today" : ""}`) : null,
          s.n > 0 ? h("span", { class: "chip", title: "Current streak" }, `🔥 ${s.n} ${s.unit}${s.n > 1 ? "s" : ""}`) : null),
        progressBar(p, unitText(hb)),
        strip && weekStrip(hb, totals, today)),
      hb.kind === "amount" ? control : null),
    page && details(hb, totals, today));
  return li;
}

function weekStrip(hb, totals, today) {
  const start = mondayOf(today);
  return h("div", { class: "strip" }, Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i), t = totals(hb.id, d), sch = scheduled(hb, d), ok = dayDone(hb, t), future = d > today;
    const cls = "dot" + (ok ? " ok" : sch && !future && d < today ? " miss" : sch ? " due" : "") + (d === today ? " today" : "");
    return h("button", {
      class: cls, disabled: future || hb.kind !== "check", title: `${shortDate(d)}${t ? ": " + num(t) : ""}`,
      onclick: () => actions.toggleHabit(hb, d),
    }, DOW[(i + 1) % 7][0]);
  }));
}

function details(hb, totals, today) {
  const cells = history(hb, totals, today, 35);
  const logs = state.habitLogs.filter(l => l.habit_id === hb.id).slice(-12).reverse();
  return h("div", { class: "habit-details" },
    h("div", { class: "heat" }, cells.map(c => h("span", { class: "cell" + (c.done ? " ok" : c.scheduled ? " sch" : ""), title: `${shortDate(c.day)}${c.total ? ": " + num(c.total) : ""}` }))),
    h("div", { class: "muted" }, "Last 5 weeks (oldest first)"),
    logs.length > 0 && h("ul", { class: "logs" }, logs.map(l => h("li", {}, `${shortDate(l.day)} · ${num(l.amount)} ${unitText(hb)}`,
      h("button", { class: "x", title: "Delete this entry", onclick: () => actions.deleteLog(l) }, "×")))),
    h("div", { class: "row" },
      h("button", { onclick: () => actions.saveHabit(hb.id, { archived: !hb.archived_at }) }, hb.archived_at ? "Restore" : "Archive"),
      h("button", { class: "danger", onclick: () => { if (confirmBox(`Delete "${hb.name}" and its history?`)) { actions.deleteHabit(hb); leavePage(); } } }, "Delete")));
}

function habitForm(hb, close) {
  const isNew = !hb;
  const name = h("input", { value: hb?.name || "", maxlength: 80, placeholder: "e.g. Exercise, DSA practice", required: true });
  let kind = hb?.kind || "check";
  const days = new Set(hb?.days || [0, 1, 2, 3, 4, 5, 6]);
  const unit = h("input", { value: hb?.unit || "", maxlength: 12, placeholder: "h, min, pages…", class: "narrow" });
  const weekly = h("input", { type: "number", step: "any", min: 0, value: hb?.weekly_target ?? "", class: "narrow" });
  const daily = h("input", { type: "number", step: "any", min: 0, value: hb?.daily_target ?? "", class: "narrow" });
  const kindSel = h("select", { onchange: () => { kind = kindSel.value; sync(); } },
    h("option", { value: "check", selected: kind === "check" }, "Done / not done each day"),
    h("option", { value: "amount", selected: kind === "amount" }, "Measured amount (hours, pages…)"));
  const amountOnly = h("div", {}, h("label", {}, "Unit", unit), h("label", {}, "Daily target (optional)", daily));
  const weeklyLabel = h("span", {});
  const sync = () => {
    amountOnly.hidden = kind !== "amount";
    weeklyLabel.textContent = kind === "amount" ? "Weekly goal (total)" : "Weekly goal (days per week, optional)";
  };
  const dayBtns = h("div", { class: "days" }, [1, 2, 3, 4, 5, 6, 0].map(i => h("button", {
    type: "button", class: days.has(i) ? "on" : "", onclick: e => { days.has(i) ? days.delete(i) : days.add(i); e.currentTarget.classList.toggle("on"); },
  }, DOW[i])));

  const f = h("form", {
    class: "task-form" + (isNew ? "" : " page"),
    onsubmit: e => {
      e.preventDefault();
      const data = { name: name.value.trim(), kind, days: [...days], weekly_target: weekly.value || null, daily_target: kind === "amount" ? daily.value || null : null, unit: kind === "amount" ? unit.value : "" };
      isNew ? actions.addHabit(data) : actions.saveHabit(hb.id, data);
      close();
    },
  },
    isNew && h("h3", {}, "New habit"),
    h("label", {}, "Name", name), h("label", {}, "Type", kindSel),
    h("div", {}, "Scheduled days", dayBtns), amountOnly,
    h("label", {}, weeklyLabel, weekly),
    h("div", { class: "row actions" }, h("span", { class: "grow" }), h("button", { type: "button", onclick: () => close() }, "Cancel"), h("button", { value: "save", class: "primary" }, "Save")));
  sync();
  return f;
}

export const openHabit = () => modal(close => habitForm(null, close));

// The habit page (#/habit/<id>): stats and history on top, the edit form below (kept between re-renders).
let hpage = null;
export const forgetHabitPage = () => { hpage = null; };
const backButton = () => h("button", { class: "burger-back x back", "aria-label": "Back", title: "Back", onclick: leavePage }, "←");
export function renderHabitPage(id) {
  const hb = state.habits.find(x => x.id === id);
  if (!hb) return h("div", {}, h("header", {}, backButton(), h("h2", { class: "grow" }, "Habit not found")));
  if (hpage?.id !== id) hpage = { id, form: habitForm(hb, leavePage) };
  return h("div", {},
    h("header", {}, backButton(), h("h2", { class: "grow" }, hb.name)),
    h("ul", { class: "habits" }, habitRow(hb, { strip: true, page: true })),
    h("h3", {}, "Edit"), hpage.form);
}


export function renderHabits() {
  const list = activeHabits(), archived = state.habits.filter(x => x.archived_at);
  return h("div", {},
    h("header", {}, h("button", { class: "burger", "aria-label": "Menu", onclick: () => { state.menu = !state.menu; render(); } }, "☰"), h("h2", { class: "grow" }, "Habits & goals"), h("button", { class: "primary", onclick: () => openHabit() }, "+ New habit")),
    list.length
      ? h("ul", { class: "habits" }, list.map(hb => habitRow(hb, { strip: true })))
      : h("p", { class: "empty" }, "No habits yet. Keep it to 3–5 that matter, e.g. Exercise, Meditation, DSA (measured in hours, goal 14 per week)."),
    archived.length > 0 && h("details", {}, h("summary", {}, `Archived (${archived.length})`), h("ul", { class: "habits" }, archived.map(hb => habitRow(hb)))));
}
