// Month calendar of tasks by due date. Click a day to see/add that day's tasks.
import { h } from "../ui.js";
import { state, render } from "../state.js";
import { isoDay, addDays, addMonths, monthOf, daysInMonth, mondayOf, monthTitle, longDate, DOW } from "../time.js";
import { taskRow } from "../taskrow.js";
import { addForm } from "./tasks.js";

export function renderCalendar() {
  const today = isoDay();
  const month = (state.calMonth ??= monthOf(today));
  const first = `${month}-01`;
  const start = mondayOf(first);
  const weeks = Math.ceil(((new Date(first).getUTCDay() + 6) % 7 + daysInMonth(month)) / 7);
  const byDay = new Map();
  for (const t of state.tasks) if (t.due && !t.parent_id) (byDay.get(t.due) ?? byDay.set(t.due, []).get(t.due)).push(t);

  const cell = day => {
    const tasks = (byDay.get(day) ?? []).sort((a, b) => !!a.done_at - !!b.done_at || (a.due_time || "").localeCompare(b.due_time || ""));
    return h("button", {
      class: "cal-cell" + (monthOf(day) !== month ? " other" : "") + (day === today ? " today" : "") + (day === state.calDay ? " sel" : ""),
      onclick: () => { state.calDay = state.calDay === day ? null : day; render(); },
    },
      h("span", { class: "n" }, Number(day.slice(8))),
      tasks.slice(0, 3).map(t => h("span", { class: "ev" + (t.done_at ? " done" : "") }, t.title)),
      tasks.length > 3 && h("span", { class: "more" }, `+${tasks.length - 3} more`));
  };

  const sel = state.calDay;
  const selTasks = sel ? state.tasks.filter(t => t.due === sel).sort((a, b) => !!a.done_at - !!b.done_at) : [];
  return h("div", {},
    h("header", {},
      h("button", { class: "burger", onclick: () => { state.menu = !state.menu; render(); } }, "☰"),
      h("h2", { class: "grow" }, monthTitle(month)),
      h("button", { onclick: () => { state.calMonth = addMonths(month, -1); render(); } }, "‹"),
      h("button", { onclick: () => { state.calMonth = monthOf(today); state.calDay = today; render(); } }, "Today"),
      h("button", { onclick: () => { state.calMonth = addMonths(month, 1); render(); } }, "›")),
    h("div", { class: "cal" },
      DOW.slice(1).concat(DOW[0]).map(d => h("div", { class: "dow" }, d)),
      Array.from({ length: weeks * 7 }, (_, i) => cell(addDays(start, i)))),
    sel && h("section", { class: "group" },
      h("h3", {}, longDate(sel)),
      addForm({ due: sel }),
      selTasks.length ? h("ul", {}, selTasks.map(t => taskRow({ task: t, subs: state.tasks.filter(s => s.parent_id === t.id), parent: null }, { showList: true }))) : h("p", { class: "muted" }, "Nothing scheduled.")));
}
