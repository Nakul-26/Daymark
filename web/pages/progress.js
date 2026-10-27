// Progress: how the week is going. Tasks completed per day, and each habit's weekly bars + streak.
import { h } from "../ui.js";
import { state, render } from "../state.js";
import { isoDay, addDays, dayOf, mondayOf, shortDate } from "../time.js";
import { makeTotals, weekProgress, weeklyBars, streak, adherence } from "../habitstats.js";
import { num } from "../ui.js";
import { activeHabits } from "./habits.js";

const bars = (items, max) => h("div", { class: "bars" }, items.map(i => h("div", { class: "barcol", title: i.title },
  h("div", { class: "barfill" + (i.met ? " met" : ""), style: `height:${max ? Math.round((i.value / max) * 100) : 0}%` }),
  h("span", {}, i.label))));

export function renderProgress() {
  const today = isoDay();
  const doneByDay = new Map();
  for (const t of state.tasks) if (t.done_at) { const d = dayOf(t.done_at); doneByDay.set(d, (doneByDay.get(d) || 0) + 1); }
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const weekStart = mondayOf(today);
  const doneWeek = Array.from({ length: 7 }, (_, i) => doneByDay.get(addDays(weekStart, i)) || 0).reduce((a, b) => a + b, 0);
  const open = state.tasks.filter(t => !t.done_at);
  const overdue = open.filter(t => t.due && t.due < today).length;
  const tile = (v, l) => h("div", { class: "tile" }, h("b", {}, v), h("span", {}, l));
  const totals = makeTotals(state.habitLogs);
  const max = Math.max(1, ...days.map(d => doneByDay.get(d) || 0));

  return h("div", {},
    h("header", {}, h("button", { class: "burger", onclick: () => { state.menu = !state.menu; render(); } }, "☰"), h("h2", { class: "grow" }, "Progress")),
    h("div", { class: "tiles" }, tile(doneWeek, "done this week"), tile(open.length, "open tasks"), tile(overdue, "overdue"), tile(state.captures.filter(c => c.status === "inbox").length, "in inbox")),
    h("section", { class: "group" }, h("h3", {}, "Tasks completed, last 14 days"),
      bars(days.map(d => ({ value: doneByDay.get(d) || 0, label: d.slice(8), title: `${shortDate(d)}: ${doneByDay.get(d) || 0}` })), max)),
    h("section", { class: "group" }, h("h3", {}, "Habits"),
      activeHabits().length ? activeHabits().map(hb => {
        const w = weeklyBars(hb, totals, today, 8), cur = weekProgress(hb, totals, today), s = streak(hb, totals, today), a = adherence(hb, totals, today, 28);
        const top = Math.max(1, ...w.map(x => x.value), hb.weekly_target || 0);
        return h("div", { class: "habit-progress" },
          h("div", { class: "title" }, hb.name, h("span", { class: "chip" }, `🔥 ${s.n} ${s.unit}${s.n === 1 ? "" : "s"}`),
            a != null && h("span", { class: "chip" }, `${Math.round(a * 100)}% of last 28 days`)),
          h("div", { class: "muted" }, cur.target != null ? `This week: ${num(cur.value)} / ${num(cur.target)} ${hb.unit}` : `This week: ${num(cur.value)} ${hb.unit}`),
          bars(w.map(x => ({ value: x.value, met: x.met, label: x.start.slice(5), title: `Week of ${shortDate(x.start)}: ${num(x.value)}${x.target != null ? " / " + num(x.target) : ""}` })), top));
      }) : h("p", { class: "muted" }, "Add habits to see weekly progress here.")));
}
