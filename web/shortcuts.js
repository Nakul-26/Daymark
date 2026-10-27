// Google Tasks style keyboard shortcuts for a focused task row, plus the Ctrl+/ help dialog.
// Ctrl means ⌘ on a Mac. rowKey() is called from taskrow.js; global keys live in app.js.
import { h, modal } from "./ui.js";
import { state } from "./state.js";
import { actions } from "./actions.js";
import { openTask } from "./taskdialog.js";

const mod = e => e.ctrlKey || e.metaKey;
const rows = () => [...document.querySelectorAll("#main li.task")];
const idOf = el => (el?.matches?.("li.task") ? Number(el.dataset.id) : null);

function chooseList(t) {
  modal(close => h("div", { class: "task-form" }, h("h3", {}, "Move to list"),
    state.lists.map(l => h("button", { type: "button", disabled: l.id === t.list_id, onclick: () => { close(); actions.saveTask(t.id, { list_id: l.id }, null); } }, l.name))));
}

// Returns true when the key was handled (the caller then skips the browser default).
export function rowKey(e, t, li) {
  const k = e.key;
  const go = row => { row?.focus(); return true; };
  if (mod(e)) {
    if (k === "]" && !t.parent_id) { const p = idOf(li.previousElementSibling); if (p) actions.indent(t, p); return true; }
    if (k === "[" && t.parent_id) { actions.unindent(t); return true; }
    if (k === "ArrowUp") { e.shiftKey ? actions.moveEdge(t, "top") : actions.nudge(t, -1); return true; }
    if (k === "ArrowDown") { e.shiftKey ? actions.moveEdge(t, "bottom") : actions.nudge(t, 1); return true; }
    return false;
  }
  if (e.altKey) { // older Daymark shortcut
    if (k === "ArrowUp") { actions.nudge(t, -1); return true; }
    if (k === "ArrowDown") { actions.nudge(t, 1); return true; }
    return false;
  }
  if (k === " ") { actions.toggle(t); return true; }
  if (k === "Enter") { openTask(t.id); return true; }
  if (k === "s") { actions.star(t); return true; }
  if ((k === "+" || k === "=") && !t.starred) { actions.star(t); return true; }
  if (k === "-" && t.starred) { actions.star(t); return true; }
  if ((k === "." || k === "v") && !t.parent_id) { chooseList(t); return true; }
  const all = rows(), i = all.indexOf(li);
  if (k === "ArrowDown") return go(all[i + 1]);
  if (k === "ArrowUp") return go(all[i - 1]);
  if (k === "Home") return go(all[0]);
  if (k === "End") return go(all[all.length - 1]);
  return false;
}

const SHORTCUTS = [
  ["With a task selected", [
    ["Space", "Mark complete"], ["Enter", "Open details"],
    ["↑  ↓", "Select previous / next task"], ["Home  End", "Select first / last task"],
    ["Ctrl+]  Ctrl+[", "Indent / unindent (make or undo a subtask)"],
    ["Ctrl+↑  Ctrl+↓", "Move up / down"], ["Ctrl+Shift+↑  ↓", "Move to top / bottom"],
    ["s", "Star or unstar"], ["+  =", "Star"], ["-", "Unstar"], [".  v", "Move to list"]]],
  ["Anywhere", [
    ["n", "New task"], ["c", "Quick capture"], ["/", "Search"],
    ["Ctrl+Z", "Undo (while the Undo bar is showing)"], ["Ctrl+/", "Show this list"]]],
];

export function showShortcuts() {
  if (document.querySelector("dialog[open]")) return;
  modal(close => h("div", { class: "task-form shortcuts" }, h("h3", {}, "Keyboard shortcuts"),
    h("p", { class: "hint" }, "Ctrl means ⌘ on a Mac."),
    SHORTCUTS.map(([title, items]) => h("section", {}, h("h4", {}, title),
      h("dl", {}, items.map(([keys, what]) => [h("dt", {}, h("kbd", {}, keys)), h("dd", {}, what)])))),
    h("div", { class: "row actions" }, h("span", { class: "grow" }), h("button", { type: "button", class: "primary", onclick: close }, "Close"))));
}
