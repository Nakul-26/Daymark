// In-app notification history (reminders that fired, daily summaries).
import { h } from "../ui.js";
import { state, render } from "../state.js";
import { actions } from "../actions.js";
import { agoLabel } from "../time.js";
import { openTask } from "../taskdialog.js";

export const unreadCount = () => state.notifications.filter(n => !n.read_at).length;

export function renderNotifications() {
  const unread = unreadCount();
  return h("div", {},
    h("header", {},
      h("button", { class: "burger", onclick: () => { state.menu = !state.menu; render(); } }, "☰"),
      h("h2", { class: "grow" }, "Notifications"),
      unread > 0 && h("button", { onclick: () => actions.markRead() }, "Mark all read"),
      state.notifications.length > 0 && h("button", { class: "danger", onclick: () => actions.clearNotifications() }, "Clear")),
    state.notifications.length
      ? h("ul", { class: "notifs" }, state.notifications.map(n => h("li", {
        class: "notif" + (n.read_at ? "" : " unread"),
        onclick: () => { if (!n.read_at) actions.markRead([n.id]); if (n.type === "report") location.hash = n.title.startsWith("Your week") ? "#/report/week" : "#/report/day"; else if (n.type === "time") location.hash = "#/time"; else if (n.task_id && state.tasks.some(t => t.id === n.task_id)) openTask(n.task_id); },
      }, h("div", { class: "title" }, (n.type === "reminder" ? "🔔 " : n.type === "report" ? "🧾 " : n.type === "time" ? "⏱ " : "☀ ") + n.title), n.body && h("div", { class: "muted" }, n.body), h("div", { class: "meta" }, agoLabel(n.created_at)))))
      : h("p", { class: "empty" }, "No notifications yet. Add a reminder to a task and it will show up here."));
}
