// Reports: numbers for one day or one Monday-Sunday week. The server also sends these as notifications on a schedule.
import { h } from "../ui.js";
import { state, render } from "../state.js";
import { api } from "../api.js";
import { isoDay, addDays, longDate, shortDate } from "../time.js";
import { fmtDur } from "./time.js";

const view = { period: "day", date: null };
let cache = { key: "", data: null, err: "" };

// opened from a report notification: #/report/day or #/report/week
export const showReport = period => { view.period = period; view.date = null; cache = { key: "", data: null, err: "" }; };

function load(key) {
  if (cache.key === key) return;
  cache = { key, data: null, err: "" };
  api.report(view.period, view.date || isoDay()).then(d => { if (cache.key === key) { cache.data = d; render(); } })
    .catch(e => { if (cache.key === key) { cache.err = e.message; render(); } });
}

const tile = (v, l) => h("div", { class: "tile" }, h("b", {}, v), h("span", {}, l));
const bars = (items, max) => h("div", { class: "bars" }, items.map(i => h("div", { class: "barcol", title: i.title },
  h("div", { class: "barfill", style: `height:${max ? Math.round((i.value / max) * 100) : 0}%` }), h("span", {}, i.label))));
const dow = d => new Date(d + "T12:00Z").toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }).slice(0, 2);

function title(r) {
  if (r.period === "day") return r.from === r.today ? "Today" : longDate(r.from);
  return r.to >= r.today && r.from <= r.today ? "This week" : `${shortDate(r.from)} – ${shortDate(r.to)}`;
}

function body(r) {
  const week = r.period === "week", rate = r.habitRate == null ? "–" : Math.round(r.habitRate * 100) + "%";
  return [
    h("div", { class: "tiles" }, tile(r.tasks.done, "tasks done"), tile(rate, "habits done"), tile(r.time.totalMs ? fmtDur(r.time.totalMs) : "–", "tracked"), tile(r.tasks.overdue, "overdue now")),
    week && h("section", { class: "group" }, h("h3", {}, "Tasks done per day"),
      bars(r.tasks.byDay.map(d => ({ value: d.n, label: dow(d.day), title: `${shortDate(d.day)}: ${d.n}` })), Math.max(1, ...r.tasks.byDay.map(d => d.n)))),
    r.tasks.list.length > 0 && h("section", { class: "group" }, h("h3", {}, "Completed"),
      h("ul", { class: "plain" }, r.tasks.list.map(t => h("li", {}, "✓ " + t.title, week && h("span", { class: "muted" }, " · " + shortDate(t.day)))))),
    r.habits.length > 0 && h("section", { class: "group" }, h("h3", {}, "Habits"),
      h("ul", { class: "plain" }, r.habits.map(x => h("li", { class: "row" }, h("span", { class: "grow" }, x.name),
        h("b", {}, x.kind === "amount" ? `${+x.amount.toFixed(2)} ${x.unit}`.trim() : `${x.hit}/${x.scheduled}`))))),
    h("section", { class: "group" }, h("h3", {}, "Time"),
      r.time.byActivity.length ? [
        week && bars(r.time.byDay.map(d => ({ value: d.ms, label: dow(d.day), title: `${shortDate(d.day)}: ${fmtDur(d.ms)}` })), Math.max(1, ...r.time.byDay.map(d => d.ms))),
        h("ul", { class: "tbars" }, r.time.byActivity.map(a => h("li", {}, h("div", { class: "tbar-top" }, h("span", {}, a.activity), h("b", {}, fmtDur(a.ms))),
          h("div", { class: "tbar" }, h("i", { style: `width:${Math.round(a.ms / r.time.byActivity[0].ms * 100)}%` })))))]
        : h("p", { class: "muted" }, "Nothing tracked.")),
  ];
}

export function renderReport() {
  const date = view.date || isoDay(), key = view.period + date;
  load(key);
  const step = view.period === "week" ? 7 : 1, r = cache.data;
  const go = n => { view.date = addDays(date, n * step); render(); };
  const tab = (p, label) => h("button", { class: "pill" + (view.period === p ? " on" : ""), onclick: () => { view.period = p; render(); } }, label);
  return h("div", { class: "report-page" },
    h("header", {}, h("button", { class: "burger", onclick: () => { state.menu = !state.menu; render(); } }, "☰"), h("h2", { class: "grow" }, "Reports")),
    h("div", { class: "pills" }, tab("day", "Daily"), tab("week", "Weekly")),
    h("div", { class: "row report-nav" }, h("button", { "aria-label": "Previous", onclick: () => go(-1) }, "‹"),
      h("b", { class: "grow" }, r ? title(r) : "…"),
      h("button", { "aria-label": "Next", disabled: r && r.to >= r.today, onclick: () => go(1) }, "›")),
    cache.err ? h("p", { class: "err" }, cache.err) : r ? body(r) : h("p", { class: "muted" }, "Loading…"));
}
