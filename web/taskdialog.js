// The task page (#/task/<id>): everything about one task. Subtasks and ↑/↓ act immediately; Save applies the form.
import { h } from "./ui.js";
import { state, leavePage } from "./state.js";
import { actions } from "./actions.js";
import { DOW } from "./datemath.js";
import { isoDay, addDays } from "./time.js";

const PRESETS = [[0, "At time"], [10, "10 min before"], [30, "30 min before"], [60, "1 hour before"], [1440, "1 day before"]];
const UNITS = { daily: "days", weekly: "weeks", monthly: "months", yearly: "years" };

export const openTask = id => { location.hash = "#/task/" + id; };

// The page keeps its form between re-renders so unsaved edits survive; app.js forgets it when you leave.
let page = null;
export const forgetTaskPage = () => { page = null; };
export function renderTaskPage(id) {
  if (page?.id !== id) {
    if (!state.tasks.some(t => t.id === id)) return h("div", { class: "empty" }, h("p", {}, "This task no longer exists."), h("button", { onclick: leavePage }, "← Back"));
    page = { id, el: buildTaskForm(id, leavePage) };
  }
  return page.el;
}

function buildTaskForm(id, close) {
  let t = state.tasks.find(x => x.id === id);
  const isSub = !!t.parent_id;

  // --- fields ---
  const title = h("input", { class: "task-title", value: t.title, maxlength: 240, "aria-label": "Title" });
  const notes = h("textarea", { class: "task-notes", rows: 1, placeholder: "Add details" }, t.notes);
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
  const repeatDetail = h("span", { class: "inline" }, "every ", interval, unit);
  // "Ends": Never / On a date / After N occurrences (the current one counts)
  const end = rule?.end;
  const endKind = h("select", {}, [["", "Never"], ["on", "On date"], ["after", "After"]]
    .map(([v, l]) => h("option", { value: v, selected: (end?.on ? "on" : end?.count != null ? "after" : "") === v }, l)));
  const endDate = h("input", { type: "date", value: end?.on || "" });
  const endCount = h("input", { type: "number", min: 1, max: 999, value: end?.count ?? 10, class: "narrow" });
  const endUnit = h("span", {}, " occurrences");
  const endRow = h("div", { class: "row" }, "Ends", endKind, endDate, endCount, endUnit);
  const limits = h("p", { class: "hint" });
  const hasSubs = () => state.tasks.some(s => s.parent_id === t.id);
  const syncRepeat = () => {
    repeatDetail.hidden = endRow.hidden = !freq.value;
    dayBtns.hidden = freq.value !== "weekly";
    unit.textContent = " " + (UNITS[freq.value] || "");
    endDate.hidden = endKind.value !== "on";
    endCount.hidden = endUnit.hidden = endKind.value !== "after";
    endDate.min = due.value;
    // Google Tasks: tasks with subtasks can't repeat; repeating tasks can't have subtasks or change list
    freq.disabled = hasSubs();
    list.disabled = isSub || !!freq.value;
    if (freq.value) list.value = String(t.list_id);
    newSub.disabled = addSubBtn.disabled = !!freq.value;
    limits.textContent = hasSubs() ? "Tasks with subtasks can't repeat."
      : freq.value ? "Repeating tasks can't have subtasks or be moved to another list."
      : "";
    limits.hidden = !limits.textContent;
  };
  endKind.addEventListener("change", () => {
    if (endKind.value === "on" && !endDate.value) endDate.value = addDays(due.value || isoDay(), 30);
    syncRepeat();
  });
  freq.addEventListener("change", () => { syncRepeat(); if (freq.value && !due.value) due.value = state.calDay || isoDay(); });

  // reminders: set of "o:<minutes>" or "c:<YYYY-MM-DDTHH:MM>"
  const mine = state.reminders.filter(r => r.task_id === t.id && !r.snooze);
  const picked = new Set(mine.map(r => (r.offset_min != null ? `o:${r.offset_min}` : `c:${r.custom_local}`)));
  const remDiv = h("div", {});
  const custom = h("input", { type: "datetime-local" });
  const drawReminders = () => {
    const addCustom = () => { if (custom.value) { picked.add("c:" + custom.value.slice(0, 16)); custom.value = ""; drawReminders(); } };
    remDiv.replaceChildren(...[
      h("div", { class: "checks" },
        ...PRESETS.map(([m, label]) => h("label", { class: "check-row" },
          h("input", { type: "checkbox", checked: picked.has(`o:${m}`), onchange: e => (e.target.checked ? picked.add(`o:${m}`) : picked.delete(`o:${m}`)) }), label)),
        ...[...picked].filter(k => k.startsWith("c:")).map(k => h("span", { class: "check-row" }, "⏰ " + k.slice(2).replace("T", " "),
          h("button", { type: "button", class: "x", title: "Remove", onclick: () => { picked.delete(k); drawReminders(); } }, "×")))),
      h("div", { class: "row" }, custom, h("button", { type: "button", onclick: addCustom }, "Add custom")),
      !due.value && h("p", { class: "hint" }, "“Before” reminders need a date. A custom reminder works without one.")].filter(Boolean));
  };

  // subtasks
  const subsDiv = h("div", {});
  const subsCount = h("span", {});
  const newSub = h("input", { placeholder: "Add a subtask", class: "grow" });
  const addSubBtn = h("button", { type: "button", onclick: () => addSub() }, "Add");
  const drawSubs = () => {
    const subs = state.tasks.filter(s => s.parent_id === t.id).sort((a, b) => a.position - b.position || a.id - b.id);
    subsDiv.replaceChildren(...subs.map(s => h("div", { class: "check-row sub-edit" + (s.done_at ? " done" : "") },
      h("button", { type: "button", class: "check", onclick: async () => { await actions.toggle(s); drawSubs(); } }, s.done_at ? "✓" : ""),
      h("span", { class: "grow title", onclick: () => openTask(s.id) }, s.title),
      h("button", { type: "button", class: "x", title: "Delete subtask", onclick: async () => { await actions.remove(s); drawSubs(); } }, "×"))));
    subsCount.textContent = subs.length ? ` (${subs.length})` : "";
    syncRepeat();
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
    const ends = endKind.value === "on" && endDate.value ? { on: endDate.value }
      : endKind.value === "after" ? { count: Math.max(1, Math.floor(Number(endCount.value)) || 1) } : null;
    set("repeat", freq.value && due.value
      ? { freq: freq.value, interval: Math.max(1, Number(interval.value) || 1), ...(freq.value === "weekly" && weekDays.size && { days: [...weekDays].sort() }), ...(ends && { end: ends }) }
      : null);
    return p;
  };
  const buildReminders = () => [...picked].map(k => (k[0] === "o" ? { offset_min: Number(k.slice(2)) } : { custom_local: k.slice(2) }));

  const quick = [];
  const syncQuick = () => quick.forEach(([b, day]) => b.classList.toggle("on", due.value === day));
  const quickDate = (label, day) => {
    const b = h("button", { type: "button", class: "pill", onclick: () => { due.value = day; drawReminders(); syncQuick(); } }, label);
    quick.push([b, day]);
    return b;
  };

  const body = h("form", {
    class: "task-form page",
    onsubmit: e => {
      e.preventDefault();
      const v = e.submitter?.value;
      if (v === "delete") actions.remove(t);
      else if (v === "save") actions.saveTask(t.id, buildPatch(), isSub ? null : buildReminders());
      else if (v === "complete") actions.toggle(t);
      else return;
      close();
    },
  },
    h("div", { class: "dlg-head" },
      h("button", { type: "button", class: "x back", title: "Back", "aria-label": "Back", onclick: () => close() }, "←"), title,
      h("button", { type: "button", class: "star" + (t.starred ? " on" : ""), title: "Star", "aria-label": "Star", onclick: async e => { await actions.star(t); t = state.tasks.find(x => x.id === t.id); e.target.className = "star" + (t.starred ? " on" : ""); e.target.textContent = t.starred ? "★" : "☆"; } }, t.starred ? "★" : "☆")),
    notes,
    h("div", { class: "block" },
      h("div", { class: "block-title" }, "When"),
      h("div", { class: isSub ? "grid2" : "grid3" }, h("label", {}, "Date", due), h("label", {}, "Time", time), !isSub && h("label", {}, "List", list)),
      h("div", { class: "pills" },
        quickDate("Today", isoDay()), quickDate("Tomorrow", addDays(isoDay(), 1)), quickDate("Next week", addDays(isoDay(), 7)),
        h("button", { type: "button", class: "link", onclick: () => { due.value = ""; time.value = ""; freq.value = ""; syncRepeat(); drawReminders(); syncQuick(); } }, "Clear date"))),
    !isSub && h("div", { class: "block" },
      h("div", { class: "row" }, h("span", { class: "block-title" }, "Repeat"), freq, repeatDetail), dayBtns, endRow, limits,
      t.repeat && h("p", { class: "hint" }, "Changing the date moves only this one. Changing the repeat settings restarts the series from this date."),
      t.repeat && h("div", { class: "row" }, h("button", { type: "button", class: "danger", onclick: () => { close(); actions.saveTask(t.id, { repeat: null }, null); } }, "Stop repeating"))),
    !isSub && h("details", { class: "block", open: picked.size > 0 }, h("summary", {}, "🔔 Reminders"), remDiv),
    !isSub && h("details", { class: "block", open: state.tasks.some(x => x.parent_id === t.id) }, h("summary", {}, "Subtasks", subsCount), subsDiv,
      h("div", { class: "row" }, newSub, addSubBtn)),
    t.done_at && h("p", { class: "hint" }, "Completed " + new Date(t.done_at).toLocaleString()),
    h("div", { class: "row tools" },
      h("button", { value: "delete", formnovalidate: true, class: "danger" }, "Delete"),
      isSub && h("button", { type: "button", title: "Make this a normal task (Ctrl+[)", onclick: () => { close(); actions.unindent(t); } }, "⇤ Unindent"),
      !isSub && !t.done_at && h("button", { type: "button", title: "Make this a subtask of the task above (Ctrl+])", onclick: () => { close(); actions.indentAbove(t); } }, "⇥ Indent"),
      h("button", { type: "button", title: "Start a timer for this task", onclick: () => actions.timeStart(t.title, t.id) }, "⏱ Track"),
      !isSub && h("button", { type: "button", title: "Move up", onclick: () => actions.nudge(t, -1) }, "↑"),
      !isSub && h("button", { type: "button", title: "Move down", onclick: () => actions.nudge(t, 1) }, "↓")),
    h("div", { class: "row actions" },
      h("span", { class: "grow" }),
      h("button", { value: "complete", formnovalidate: true }, t.done_at ? "Mark not done" : "Mark done"),
      h("button", { value: "save", class: "primary" }, "Save")));
  newSub.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addSub(); } });
  title.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); body.requestSubmit(body.querySelector("[value=save]")); } });
  syncRepeat(); drawReminders(); drawSubs();
  const grow = () => { notes.style.height = "auto"; notes.style.height = Math.min(notes.scrollHeight, 200) + "px"; };
  notes.addEventListener("input", grow); grow();
  due.addEventListener("change", () => { drawReminders(); syncQuick(); syncRepeat(); });
  syncQuick();
  setTimeout(grow, 0);
  return body;
}
