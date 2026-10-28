// Everything that changes data: call the API, update `state`, re-render, show Undo toasts.
// Pages only call these; they never talk to the API directly (except Settings device/push bits).
import { api } from "./api.js";
import { state, render, loadAll } from "./state.js";
import { toast } from "./ui.js";
import { isoDay, dueLabel } from "./time.js";
import { moveToEdge, placeAfter } from "./order.js";

// Run an async change. On failure: tell the user and re-sync from the server.
async function act(fn) {
  try { return await fn(); }
  catch (e) {
    if (e.message === "UNAUTH") { document.dispatchEvent(new Event("daymark:unauth")); return; }
    toast(e.message, { error: true });
    await loadAll().catch(() => {});
  } finally { render(); }
}

const put = (list, item) => { const i = list.findIndex(x => x.id === item.id); i < 0 ? list.unshift(item) : (list[i] = item); };
export const refreshReminders = async () => { state.reminders = await api.reminders(); };
export const refreshNotifications = async () => { state.notifications = await api.notifications(); };
export const subtasksOf = id => state.tasks.filter(t => t.parent_id === id);

export const actions = {
  // ---- tasks ----
  addTask: fields => act(async () => {
    const t = await api.addTask(fields);
    put(state.tasks, t);
    return t;
  }),

  saveTask: (id, patch, reminders) => act(async () => {
    if (Object.keys(patch).length) {
      const t = await api.patchTask(id, patch);
      put(state.tasks, t);
      if ("list_id" in patch) state.tasks.forEach(x => { if (x.parent_id === id) x.list_id = t.list_id; });
      // clearing the date also clears time and repeat on the server; re-read to stay in sync
      if ("due" in patch) state.tasks = await api.tasks();
    }
    if (reminders) await api.setReminders(id, reminders);
    await refreshReminders();
  }),

  star: t => act(async () => { put(state.tasks, await api.patchTask(t.id, { starred: t.starred ? 0 : 1 })); }),

  toggle: t => act(async () => {
    if (t.done_at) {
      put(state.tasks, { ...t, done_at: null }); // optimistic
      render();
      put(state.tasks, await api.reopenTask(t.id));
      return;
    }
    put(state.tasks, { ...t, done_at: new Date().toISOString() }); // optimistic
    render();
    const { task, next } = await api.completeTask(t.id);
    put(state.tasks, task);
    if (next) { state.tasks = await api.tasks(); await refreshReminders(); }
    toast(next ? `Done. Next: ${dueLabel(next.due, next.due_time)}` : t.repeat && !t.parent_id ? "Done. That was the last repeat" : "Task completed", {
      undo: () => act(async () => {
        put(state.tasks, await api.reopenTask(t.id, next?.id));
        if (next) { state.tasks = await api.tasks(); await refreshReminders(); }
      }),
    });
  }),

  remove: t => act(async () => {
    await api.delTask(t.id);
    state.tasks = state.tasks.filter(x => x.id !== t.id && x.parent_id !== t.id);
    toast("Task deleted", {
      undo: () => act(async () => { (await api.restoreTask(t.id)).forEach(x => put(state.tasks, x)); await refreshReminders(); }),
    });
  }),

  reorder: ids => act(async () => {
    ids.forEach((id, i) => { const t = state.tasks.find(x => x.id === id); if (t) t.position = i; });
    render();
    await api.reorder(ids);
  }),

  // Open tasks of the same list and parent, in "My order".
  siblings: t => state.tasks.filter(x => !x.done_at && x.list_id === t.list_id && x.parent_id === t.parent_id)
    .sort((a, b) => a.position - b.position || b.id - a.id),

  // move one step up (-1) or down (+1) among its siblings
  nudge: (t, dir) => {
    const sibs = actions.siblings(t);
    const i = sibs.findIndex(x => x.id === t.id), j = i + dir;
    if (i < 0 || j < 0 || j >= sibs.length) return;
    [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
    return actions.reorder(sibs.map(x => x.id));
  },

  moveEdge: (t, edge) => actions.reorder(moveToEdge(actions.siblings(t).map(x => x.id), t.id, edge)),

  // Make `t` the last subtask of the task `parentId` (Ctrl+] / "Indent").
  indent: (t, parentId) => {
    const p = state.tasks.find(x => x.id === parentId);
    if (!p || t.parent_id || p.parent_id || p.id === t.id) return;
    if (p.repeat) return toast("Repeating tasks can't have subtasks", { error: true });
    if (p.list_id !== t.list_id) return toast("Can only indent under a task in the same list", { error: true });
    if (subtasksOf(t.id).length) return toast("A task with subtasks can't become a subtask", { error: true });
    const last = subtasksOf(p.id).reduce((m, s) => Math.max(m, s.position), 0);
    return act(async () => { put(state.tasks, await api.patchTask(t.id, { parent_id: p.id, position: last + 1 })); });
  },
  // Indent under the task above it in "My order" (for the dialog button, where there's no row to look at).
  indentAbove: t => {
    const s = actions.siblings(t), i = s.findIndex(x => x.id === t.id);
    return i > 0 ? actions.indent(t, s[i - 1].id) : toast("No task above to indent under", { error: true });
  },
  // Turn a subtask back into a normal task, placed right after its former parent (Ctrl+[).
  unindent: t => {
    if (!t.parent_id) return;
    const parentId = t.parent_id;
    return act(async () => {
      put(state.tasks, await api.patchTask(t.id, { parent_id: null }));
      const parent = state.tasks.find(x => x.id === parentId);
      if (parent) await actions.reorder(placeAfter(actions.siblings(parent).map(x => x.id), parent.id, t.id));
    });
  },

  // ---- lists ----
  addList: name => act(async () => { const l = await api.addList(name); state.lists.push(l); return l; }),
  renameList: (l, name) => act(async () => { await api.renameList(l.id, name); l.name = name; }),
  deleteList: l => act(async () => {
    await api.delList(l.id);
    state.lists = state.lists.filter(x => x.id !== l.id);
    state.tasks = state.tasks.filter(t => t.list_id !== l.id);
  }),
  clearCompleted: l => act(async () => {
    const { deleted } = await api.clearCompleted(l.id);
    state.tasks = state.tasks.filter(t => !(t.list_id === l.id && t.done_at));
    toast(`Deleted ${deleted} completed task${deleted === 1 ? "" : "s"}`);
  }),

  // ---- quick capture ----
  addCapture: text => act(async () => { put(state.captures, await api.addCapture(text)); toast("Captured"); }),
  editCapture: (c, p) => act(async () => { put(state.captures, await api.patchCapture(c.id, p)); }),
  deleteCapture: c => act(async () => { await api.delCapture(c.id); state.captures = state.captures.filter(x => x.id !== c.id); }),
  captureToTask: (c, p) => act(async () => {
    const { task, capture } = await api.captureToTask(c.id, p);
    put(state.tasks, task); put(state.captures, capture);
    toast("Turned into a task");
    return task;
  }),

  // ---- habits ----
  addHabit: h => act(async () => { state.habits.push(await api.addHabit(h)); }),
  saveHabit: (id, p) => act(async () => { put(state.habits, await api.patchHabit(id, p)); }),
  deleteHabit: h => act(async () => {
    await api.delHabit(h.id);
    state.habits = state.habits.filter(x => x.id !== h.id);
    state.habitLogs = state.habitLogs.filter(l => l.habit_id !== h.id);
  }),
  toggleHabit: (h, day = isoDay()) => act(async () => {
    const logs = await api.toggleHabit(h.id, day);
    state.habitLogs = [...state.habitLogs.filter(l => !(l.habit_id === h.id && l.day === day)), ...logs];
  }),
  logHabit: (h, amount, day = isoDay()) => act(async () => {
    state.habitLogs.push(await api.logHabit(h.id, day, amount));
  }),
  deleteLog: l => act(async () => { await api.delLog(l.id); state.habitLogs = state.habitLogs.filter(x => x.id !== l.id); }),

  // ---- notifications & settings ----
  markRead: ids => act(async () => { await api.readNotifications(ids); await refreshNotifications(); }),
  clearNotifications: () => act(async () => { await api.clearNotifications(); state.notifications = []; }),
  saveSettings: s => act(async () => { state.settings = await api.saveSettings(s); await refreshReminders(); }),
};
