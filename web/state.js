// The one shared state object + load/render plumbing. Pages read `state`; actions.js changes it and calls render().
import { api } from "./api.js";

export const state = {
  tasks: [], lists: [], reminders: [], captures: [], habits: [], habitLogs: [], notifications: [],
  settings: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, default_reminder_time: "09:00" },
  route: "myday",          // see app.js for the list
  menu: false,             // mobile sidebar open
  query: "",               // search text
  filter: { starred: false, listId: null }, // My Day filters
  calMonth: null, calDay: null,
  navs: 0,                 // how many routes were shown this session (to know if "back" stays in the app)
};

// Small per-device preferences (sort order of a list, collapsed sections...). Never required for correctness.
export const pref = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem("dm:" + key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem("dm:" + key, JSON.stringify(value)); } catch { /* private mode */ } },
};

let renderFn = () => {};
export const setRenderer = fn => (renderFn = fn);
export const render = () => renderFn();

export async function loadAll() {
  const [tasks, lists, reminders, captures, habits, notifications, settings] = await Promise.all([
    api.tasks(), api.lists(), api.reminders(), api.captures(), api.habits(), api.notifications(), api.settings(),
  ]);
  Object.assign(state, { tasks, lists, reminders, captures, habits: habits.habits, habitLogs: habits.logs, notifications, settings });
}

// Leave a task/habit page: step back in history if we came from inside the app, else go to My Day.
export function leavePage() {
  if (state.navs > 1) history.back(); else location.replace("#/myday");
}
