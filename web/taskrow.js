// One task row (with its subtasks nested underneath), used by every task list in the app.
import { h } from "./ui.js";
import { state } from "./state.js";
import { actions } from "./actions.js";
import { isoDay, dueLabel, repeatLabel } from "./time.js";
import { openTask } from "./taskdialog.js";
import { rowKey } from "./shortcuts.js";

// ctx: { showList?: bool, order?: number[] }  (order = ids in display order: enables drag to reorder)
export function taskRow(entry, ctx = {}) {
  const { task: t, subs = [], parent } = entry;
  const done = !!t.done_at;
  const today = isoDay();
  const hasReminder = state.reminders.some(r => r.task_id === t.id);
  const doneSubs = subs.filter(s => s.done_at).length;
  const list = ctx.showList && state.lists.find(l => l.id === t.list_id);

  const chips = [
    t.due && h("span", { class: "chip" + (!done && t.due < today ? " late" : "") }, "📅 " + dueLabel(t.due, t.due_time)),
    t.repeat && h("span", { class: "chip", title: repeatLabel(t.repeat) }, "↻ " + repeatLabel(t.repeat)),
    hasReminder && h("span", { class: "chip", title: "Has reminders" }, "🔔"),
    subs.length > 0 && h("span", { class: "chip" }, `☑ ${doneSubs}/${subs.length}`),
    list && h("span", { class: "chip" }, list.name),
    parent && h("span", { class: "chip" }, "↳ " + parent.title),
  ].filter(Boolean);

  const li = h("li", {
    class: "task" + (done ? " done" : "") + (t.parent_id && !parent ? " sub" : ""),
    tabindex: 0, "data-id": t.id,
    onkeydown: e => {
      if (e.target === li && rowKey(e, t, li)) e.preventDefault();
    },
  },
    h("div", { class: "main" },
      h("button", { class: "check", title: done ? "Mark as not done" : "Mark as done", "aria-label": done ? "Mark as not done" : "Mark as done", onclick: () => actions.toggle(t) }, done ? "✓" : ""),
      h("div", { class: "body", onclick: () => openTask(t.id) },
        h("div", { class: "title" }, t.title),
        t.notes && h("div", { class: "notes" }, t.notes),
        chips.length > 0 && h("div", { class: "chips" }, chips)),
      h("button", { class: "star" + (t.starred ? " on" : ""), title: t.starred ? "Remove star" : "Star", "aria-label": "Star", onclick: () => actions.star(t) }, t.starred ? "★" : "☆")),
    subs.length > 0 && h("ul", { class: "subs" }, subs.map(s => taskRow({ task: s, subs: [], parent: null }, {}))));

  if (ctx.order && !done && !t.parent_id) enableDrag(li, t, ctx.order);
  return li;
}

// Mouse drag-and-drop reordering (touch users: use the ↑ ↓ buttons in the task dialog).
function enableDrag(li, t, order) {
  li.draggable = true;
  li.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", String(t.id)); li.classList.add("dragging"); });
  li.addEventListener("dragend", () => li.classList.remove("dragging"));
  li.addEventListener("dragover", e => { e.preventDefault(); li.classList.toggle("drop-before", before(e, li)); li.classList.toggle("drop-after", !before(e, li)); });
  li.addEventListener("dragleave", () => li.classList.remove("drop-before", "drop-after"));
  li.addEventListener("drop", e => {
    e.preventDefault();
    li.classList.remove("drop-before", "drop-after");
    const from = Number(e.dataTransfer.getData("text/plain"));
    if (!from || from === t.id) return;
    const ids = order.filter(id => id !== from);
    ids.splice(ids.indexOf(t.id) + (before(e, li) ? 0 : 1), 0, from);
    actions.reorder(ids);
  });
}
const before = (e, el) => e.clientY < el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2;
