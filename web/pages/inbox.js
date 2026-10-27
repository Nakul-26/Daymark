// Quick Capture inbox: jot a thought now, decide later (turn into a task, archive, delete).
import { h, modal, confirmBox } from "../ui.js";
import { state, render, pref } from "../state.js";
import { actions } from "../actions.js";
import { agoLabel } from "../time.js";
import { openTask } from "../taskdialog.js";

// Global "capture a thought" dialog (press c anywhere).
export function openCapture() {
  const text = h("textarea", { rows: 4, placeholder: "What's on your mind?  (Enter to save, Shift+Enter for a new line)", maxlength: 5000 });
  modal(close => {
    const save = () => { const v = text.value.trim(); if (v) { actions.addCapture(v); close(); } };
    text.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); } });
    return h("div", { class: "task-form" }, h("h3", {}, "Quick capture"), text,
      h("div", { class: "row actions" }, h("span", { class: "grow" }), h("button", { onclick: close }, "Cancel"), h("button", { class: "primary", onclick: save }, "Save")));
  });
  text.focus();
}

function row(c) {
  const link = c.task_id && state.tasks.find(t => t.id === c.task_id);
  const btn = (label, fn, cls = "") => h("button", { class: cls, onclick: fn }, label);
  return h("li", { class: "capture" },
    h("div", { class: "text" }, c.text),
    h("div", { class: "meta" }, agoLabel(c.created_at), link && h("a", { href: "#", onclick: e => { e.preventDefault(); openTask(link.id); } }, ` · task: ${link.title}`)),
    h("div", { class: "row" },
      c.status === "inbox" && btn("→ Task", async () => { const t = await actions.captureToTask(c, {}); if (t) openTask(t.id); }),
      c.status === "inbox"
        ? btn("Archive", () => actions.editCapture(c, { status: "archived" }))
        : btn("Move to inbox", () => actions.editCapture(c, { status: "inbox" })),
      btn("Edit", () => { const v = prompt("Edit", c.text); if (v?.trim()) actions.editCapture(c, { text: v }); }),
      btn("Delete", () => confirmBox("Delete this capture?") && actions.deleteCapture(c), "danger")));
}

export function renderInbox() {
  const tab = pref.get("inboxTab", "inbox");
  const items = state.captures.filter(c => c.status === tab);
  const input = h("textarea", { id: "add-input", class: "add", rows: 2, placeholder: "Capture a thought, idea or link… (Enter to save)", maxlength: 5000 });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const v = input.value.trim(); if (v) { input.value = ""; actions.addCapture(v); } }
  });
  return h("div", {},
    h("header", {}, h("button", { class: "burger", onclick: () => { state.menu = !state.menu; render(); } }, "☰"), h("h2", { class: "grow" }, "Inbox")),
    input,
    h("div", { class: "pills" }, [["inbox", "Inbox"], ["archived", "Archived"]].map(([k, l]) =>
      h("button", { class: "pill" + (tab === k ? " on" : ""), onclick: () => { pref.set("inboxTab", k); render(); } },
        `${l} (${state.captures.filter(c => c.status === k).length})`))),
    items.length ? h("ul", { class: "captures" }, items.map(row)) : h("p", { class: "empty" }, tab === "inbox" ? "Inbox zero. Capture anything that pops into your head." : "Nothing archived."));
}
