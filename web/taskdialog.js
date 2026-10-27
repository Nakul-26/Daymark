// The task editor dialog: everything about one task. Subtasks and ↑/↓ act immediately; Save applies the form.
import { h, modal } from "./ui.js";
import { state } from "./state.js";
import { actions } from "./actions.js";
import { DOW } from "./datemath.js";
import { isoDay } from "./time.js";

const PRESETS = [[0, "At time of task"], [10, "10 minutes before"], [30, "30 minutes before"], [60, "1 hour before"], [1440, "1 day before"]];
const UNITS = { daily: "days", weekly: "weeks", monthly: "months", yearly: "years" };

export function openTask(id) {
  const t0 = state.tasks.find(t => t.id === id);
  if (!t0) return;
  let t = t0;
  const isSub = !!t.parent_id;

  // --- fields ---
  const title = h("input", { value: t.title, maxlength: 240, "aria-label": "Title" });
  const notes = h("textarea", { rows: 3, placeholder: "Details" }, t.notes);
  const due = h("input", { type: "date", value: t.due || "" });
  const time = h("input", { type: "time", value: t.due_time || "" });
  const list = h("select", { disabled: isSub }, state.lists.map(l => h("option", { value: l.id, selected: l.id === t.list_id }, l.name)));

  // repeat
  const rule = t.repeat;
  const freq = h("select", {}, [["", "Does not repeat"], ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"]]
    .map(([v, l]) => h("option", { value: v, selected: (rule?.freq || "") === v }, l)));
  const interval = h("input", { type: "number", min: 1, max: 99, value: rule?.interval || 1, class: "narrow" });
  const unit = h("span", {});
  const weekDays = new Set(rule?.days || []);
  const dayBtns = h("div", { class: "days" }, DOW.map((d, i) => h("button", {
    type: "button", class: weekDays.has(i) ? "on" : "",
    onclick: e => { weekDays.has(i) ? weekDays.delete(i) : weekDays.add(i); e.target.classList.toggle("on"); },
  }, d[0])));
  const repeatDetail = h("div", { class: "row" }, "Every ", interval, unit);
  const syncRepeat = () => {
    repeatDetail.hidden = !freq.value;
    dayBtns.hidden = freq.value !== "weekly";
    unit.textContent = " " + (UNITS[freq.value] || "");
  };
  freq.addEventListener("change", () => { syncRepeat(); if (freq.value && !due.value) due.value = state.calDay || isoDay(); });

  // reminders: set of "o:<minutes>" or "c:<YYYY-MM-DDTHH:MM>"
  const mine = state.reminders.filter(r => r.task_id === t.id);
  const picked = new Set(mine.map(r => (r.offset_min != null ? `o:${r.offset_min}` : `c:${r.custom_local}`)));
  const remDiv = h("div", {});
  const custom = h("input", { type: "datetime-local" });
  const drawReminders = () => {
    remDiv.replaceChildren(
      ...PRESETS.map(([m, label]) => h("label", { class: "check-row" },
        h("input", { type: "checkbox", checked: picked.has(`o:${m}`), onchange: e => (e.target.checked ? picked.add(`o:${m}`) : picked.delete(`o:${m}`)) }), label)),
      ...[...picked].filter(k => k.startsWith("c:")).map(k => h("div", { class: "check-row" }, "⏰ " + k.slice(2).replace("T", " "),
        h("button", { type: "button", class: "x", onclick: () => { picked.delete(k); drawReminders(); } }, "×"))),
      h("div", { class: "row" }, custom, h("button", { type: "button", onclick: () => { if (custom.value) { picked.add("c:" + custom.value.slice(0, 16)); custom.value = ""; drawReminders(); } } }, "Add")),
      !due.value && h("p", { class: "hint" }, "“Before” reminders need a date. A custom reminder works without one."));
  };

  // subtasks
  const subsDiv = h("div", {});
  const newSub = h("input", { placeholder: "Add a subtask", class: "grow" });
  const drawSubs = () => {
    const subs = state.tasks.filter(s => s.parent_id === t.id).sort((a, b) => a.position - b.position || a.id - b.id);
    subsDiv.replaceChildren(...subs.map(s => h("div", { class: "check-row sub-edit" + (s.done_at ? " done" : "") },
      h("button", { type: "button", class: "check", onclick: async () => { await actions.toggle(s); drawSubs(); } }, s.done_at ? "✓" : ""),
      h("span", { class: "grow title", onclick: () => { close(); openTask(s.id); } }, s.title),
      h("button", { type: "button", class: "x", title: "Delete subtask", onclick: async () => { await actions.remove(s); drawSubs(); } }, "×"))));
  };
  const addSub = async () => {
    const v = newSub.value.trim();
    if (!v) return;
    newSub.value = "";
    await actions.addTask({ title: v, parent_id: t.id });
    drawSubs(); newSub.focus();
  };

  // --- save ---
  const buildPatch = () => {
    const p = {};
    const set = (k, v) => { if (JSON.stringify(v) !== JSON.stringify(t[k])) p[k] = v; };
    const ttl = title.value.trim();
    if (ttl) set("title", ttl);
    set("notes", notes.value);
    set("due", due.value || null);
    set("due_time", due.value && time.value ? time.value : null);
    if (!isSub) set("list_id", Number(list.value));
    set("repeat", freq.value && due.value
      ? { freq: freq.value, interval: Math.max(1, Number(interval.value) || 1), ...(freq.value === "weekly" && weekDays.size && { days: [...weekDays].sort() }) }
      : null);
    return p;
  };
  const buildReminders = () => [...picked].map(k => (k[0] === "o" ? { offset_min: Number(k.slice(2)) } : { custom_local: k.slice(2) }));

  let close;
  modal(c => {
    close = c;
    const body = h("form", {
      method: "dialog", class: "task-form",
      onsubmit: e => {
        const v = e.submitter?.value;
        if (v === "delete") { actions.remove(t); return; }
        if (v === "save") actions.saveTask(t.id, buildPatch(), isSub ? null : buildReminders());
        if (v === "complete") actions.toggle(t);
      },
    },
      h("div", { class: "row" }, title,
        h("button", { type: "button", class: "star" + (t.starred ? " on" : ""), title: "Star", onclick: async e => { await actions.star(t); t = state.tasks.find(x => x.id === t.id); e.target.className = "star" + (t.starred ? " on" : ""); e.target.textContent = t.starred ? "★" : "☆"; } }, t.starred ? "★" : "☆")),
      notes,
      h("div", { class: "grid2" },
        h("label", {}, "Date", due, h("button", { type: "button", class: "link", onclick: () => { due.value = ""; time.value = ""; freq.value = ""; syncRepeat(); drawReminders(); } }, "Clear")),
        h("label", {}, "Time", time)),
      !isSub && h("label", {}, "Repeat", freq),
      !isSub && repeatDetail, !isSub && dayBtns,
      !isSub && h("label", {}, "List", list),
      !isSub && h("fieldset", {}, h("legend", {}, "Reminders"), remDiv),
      !isSub && h("fieldset", {}, h("legend", {}, "Subtasks"), subsDiv,
        h("div", { class: "row" }, newSub, h("button", { type: "button", onclick: addSub }, "Add"))),
      t.done_at && h("p", { class: "hint" }, "Completed " + new Date(t.done_at).toLocaleString()),
      h("div", { class: "row actions" },
        h("button", { value: "delete", formnovalidate: true, class: "danger" }, "Delete"),
        !isSub && h("button", { type: "button", title: "Move up", onclick: () => actions.nudge(t, -1) }, "↑"),
        !isSub && h("button", { type: "button", title: "Move down", onclick: () => actions.nudge(t, 1) }, "↓"),
        h("span", { class: "grow" }),
        h("button", { value: "complete", formnovalidate: true }, t.done_at ? "Mark not done" : "Mark done"),
        h("button", { value: "save", class: "primary" }, "Save")));
    newSub.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addSub(); } });
    title.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); body.requestSubmit(body.querySelector("[value=save]")); } });
    return body;
  });
  syncRepeat(); drawReminders(); drawSubs();
  due.addEventListener("change", drawReminders);
}
