// The popup you get when you open a reminder: move just this alarm (5 hours, tomorrow, next week, custom) or mark the task done.
// Snoozing only adds a one-off alarm; the task's regular reminders and repeat rule stay as they are.
import { h, modal } from "./ui.js";
import { state } from "./state.js";
import { actions } from "./actions.js";
import { openTask } from "./taskdialog.js";
import { dueLabel } from "./time.js";

const HOUR = 3600_000;
export const whenLabel = d => d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const snoozeChoices = (now = Date.now()) => [
  ["5 hours later", new Date(now + 5 * HOUR)],
  ["Tomorrow", new Date(now + 24 * HOUR)],
  ["Next week", new Date(now + 7 * 24 * HOUR)],
];

export function openAlarm(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return actions.notify("That task no longer exists");
  modal(close => {
    const pick = d => { close(); actions.snooze(t, d); };
    const custom = h("input", { type: "datetime-local", "aria-label": "Custom time" });
    const sub = [t.due && dueLabel(t.due, t.due_time), state.lists.find(l => l.id === t.list_id)?.name].filter(Boolean).join(" · ");
    return h("div", { class: "task-form alarm" },
      h("h3", {}, "🔔 " + t.title),
      sub && h("div", { class: "muted" }, sub),
      t.done_at
        ? h("p", { class: "hint" }, "This task is already completed.")
        : [h("div", { class: "block-title" }, "Remind me again"),
          h("div", { class: "snooze-opts" }, snoozeChoices().map(([label, d]) =>
            h("button", { type: "button", onclick: () => pick(d) }, h("b", {}, label), h("small", {}, whenLabel(d))))),
          h("div", { class: "row" }, custom,
            h("button", { type: "button", onclick: () => { const d = new Date(custom.value); if (custom.value && d > new Date()) pick(d); else custom.focus(); } }, "Set custom"))],
      h("div", { class: "row actions" },
        h("button", { type: "button", onclick: () => { close(); openTask(t.id); } }, "Open task"),
        h("span", { class: "grow" }),
        !t.done_at && h("button", { type: "button", class: "primary", onclick: () => { close(); actions.toggle(t); } }, "✓ Mark done")));
  });
}
