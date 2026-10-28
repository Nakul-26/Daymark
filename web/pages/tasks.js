// All task views: My Day, Upcoming, Starred, All, Completed and each list. Views are defined in views.js.
import { h, confirmBox } from "../ui.js";
import { state, pref, render } from "../state.js";
import { actions } from "../actions.js";
import { VIEWS, SORTS, listView, arrange } from "../views.js";
import { isoDay, addDays, longDate } from "../time.js";
import { taskRow } from "../taskrow.js";
import { parseQuick } from "../quickadd.js";
import { habitRow, activeHabits } from "./habits.js";
import { scheduled } from "../habitstats.js";

export const sortOf = listId => pref.get("sort:" + listId, "order");
export const allViews = () => [...VIEWS, ...state.lists.map(l => listView(l, sortOf(l.id)))];

function matchesQuery(t, q) {
  return t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q);
}

// Fields a new task gets from the view it's added in (list view -> that list, My Day -> today, ...).
export function viewDefaults(view, today = isoDay()) {
  const d = {};
  if (view.listId) d.list_id = view.listId;
  if (view.id === "myday") d.due = today;
  if (view.id === "upcoming") d.due = addDays(today, 1);
  if (view.id === "starred") d.starred = 1;
  return d;
}

export function addForm(defaults) {
  const input = h("input", { id: "add-input", class: "add", placeholder: "Add a task…   e.g. “Call mom tomorrow 5pm !”", maxlength: 240, autocomplete: "off" });
  const button = h("button", { class: "primary", type: "submit", disabled: true }, "Add");
  input.addEventListener("input", () => (button.disabled = !input.value.trim()));
  return h("form", {
    class: "add-row",
    onsubmit: e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      button.disabled = true;
      const parsed = parseQuick(text, isoDay());
      actions.addTask({ ...defaults, ...parsed });
    },
  }, input, button);
}

export function renderTasks(route) {
  const view = allViews().find(v => v.id === route) || VIEWS[0];
  const today = isoDay();
  const list = view.listId && state.lists.find(l => l.id === view.listId);
  const q = state.query.trim().toLowerCase();

  let viewTasks = view.tasks(state.tasks, today);
  if (view.id === "myday" || view.id === "all") {
    const { starred, listId } = state.filter;
    viewTasks = viewTasks.filter(t => (!starred || t.starred) && (!listId || t.list_id === listId));
  }
  let groups = view.groups(viewTasks, today);
  let shownSource = viewTasks;
  if (q) { // search looks at every task, whatever the view
    shownSource = state.tasks.filter(t => matchesQuery(t, q));
    groups = [{ title: `Search results for “${state.query.trim()}”`, tasks: shownSource.sort((a, b) => !!a.done_at - !!b.done_at) }];
  }

  const sort = list ? sortOf(list.id) : "order";
  const body = groups.map((g, gi) => {
    const entries = arrange(g.tasks, state.tasks, shownSource);
    const ctx = { showList: !view.listId, order: list && sort === "order" && !q && gi === 0 && !g.collapsed ? entries.map(e => e.task.id) : null };
    const ul = h("ul", {}, entries.map(e => taskRow(e, ctx)));
    const title = g.date ? longDate(g.date) : g.title;
    if (g.collapsed) {
      const key = `collapsed:${view.id}:${g.title}`;
      return h("details", { class: "group", open: !pref.get(key, true), ontoggle: e => pref.set(key, !e.target.open) },
        h("summary", {}, `${title} (${g.tasks.length})`), ul);
    }
    return h("section", { class: "group" }, title ? h("h3", { class: g.title === "Overdue" ? "late" : "" }, title) : null, ul);
  });

  const myday = view.id === "myday" && !q;
  const todayHabits = myday ? activeHabits().filter(hb => scheduled(hb, today)) : [];

  return h("div", {},
    h("header", {},
      h("button", { class: "burger", "aria-label": "Menu", onclick: () => { state.menu = !state.menu; render(); } }, "☰"),
      h("div", { class: "grow" }, h("h2", {}, view.label), myday && h("div", { class: "muted" }, longDate(today))),
      list && sortMenu(list),
      list && listMenu(list)),
    h("input", { id: "search-input", class: "search", type: "search", placeholder: "Search all tasks ( / )", value: state.query,
      oninput: e => { state.query = e.target.value; clearTimeout(renderTasks.t); renderTasks.t = setTimeout(() => { render(); const el = document.getElementById("search-input"); el.focus(); el.setSelectionRange(1e4, 1e4); }, 200); } }),
    view.id !== "done" && !q && addForm(viewDefaults(view, today)),
    myday && filterChips(),
    todayHabits.length > 0 && h("section", { class: "group habits-today" }, h("h3", {}, "Habits"), h("ul", { class: "habits" }, todayHabits.map(hb => habitRow(hb)))),
    body.length ? body : h("p", { class: "empty" }, q ? "No tasks match your search." : emptyText(view)));
}

const emptyText = view => ({
  myday: "Nothing due today. Add a task above, or enjoy the quiet.",
  upcoming: "No upcoming tasks with a date.", starred: "No starred tasks.", done: "No completed tasks yet.",
}[view.id] || "No tasks yet.");

function filterChips() {
  if (state.lists.length < 2 && !state.tasks.some(t => t.starred)) return null;
  const { starred, listId } = state.filter;
  const chip = (label, on, fn) => h("button", { class: "pill" + (on ? " on" : ""), onclick: () => { fn(); render(); } }, label);
  return h("div", { class: "pills" },
    chip("Everything", !starred && !listId, () => Object.assign(state.filter, { starred: false, listId: null })),
    chip("★ Important", starred, () => (state.filter.starred = !state.filter.starred)),
    state.lists.length > 1 && state.lists.map(l => chip(l.name, listId === l.id, () => (state.filter.listId = listId === l.id ? null : l.id))));
}

function sortMenu(list) {
  return h("select", { class: "sort", title: "Sort", "aria-label": "Sort", onchange: e => { pref.set("sort:" + list.id, e.target.value); render(); } },
    Object.entries(SORTS).map(([k, s]) => h("option", { value: k, selected: sortOf(list.id) === k }, "Sort: " + s.label)));
}

function listMenu(list) {
  const item = (label, fn, cls = "") => h("button", { class: cls, onclick: e => { e.target.closest("details").open = false; fn(); } }, label);
  return h("details", { class: "menu" }, h("summary", { title: "List actions", "aria-label": "List actions" }, "⋮"),
    h("div", { class: "menu-body" },
      item("Rename list", () => { const n = prompt("Rename list", list.name)?.trim(); if (n) actions.renameList(list, n); }),
      item("Delete all completed tasks", () => confirmBox("Delete all completed tasks in this list?") && actions.clearCompleted(list)),
      item("Delete list", () => {
        if (state.lists.length < 2) return alert("Keep at least one list.");
        if (confirmBox(`Delete "${list.name}" and all its tasks?`)) { actions.deleteList(list).then(() => (location.hash = "#/myday")); }
      }, "danger")));
}
