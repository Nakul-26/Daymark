// All server calls live here. Throws Error("UNAUTH") on 401 so the app can show the login screen.
async function call(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { "X-Requested-With": "daymark", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error("You're offline: that change wasn't saved."); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("UNAUTH");
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
const get = u => call("GET", u), post = (u, b = {}) => call("POST", u, b), patch = (u, b) => call("PATCH", u, b),
  put = (u, b) => call("PUT", u, b), del = u => call("DELETE", u);

export const api = {
  session: () => get("/api/session"),
  login: password => post("/api/login", { password }),
  logout: () => post("/api/logout"),
  settings: () => get("/api/settings"),
  saveSettings: s => put("/api/settings", s),

  tasks: () => get("/api/tasks"),
  addTask: t => post("/api/tasks", t),
  patchTask: (id, p) => patch(`/api/tasks/${id}`, p),
  completeTask: id => post(`/api/tasks/${id}/complete`),
  reopenTask: (id, remove_id) => post(`/api/tasks/${id}/reopen`, { remove_id }),
  delTask: id => del(`/api/tasks/${id}`),
  restoreTask: id => post(`/api/tasks/${id}/restore`),
  reorder: ids => post("/api/tasks/reorder", { ids }),
  reminders: () => get("/api/reminders"),
  snooze: (id, at) => post(`/api/tasks/${id}/snooze`, { at }),
  setReminders: (id, reminders) => put(`/api/tasks/${id}/reminders`, { reminders }),

  time: () => get("/api/time"),
  timeStart: (activity, task_id) => post("/api/time/start", { activity, task_id }),
  timeStop: () => post("/api/time/stop"),
  timeAdd: e => post("/api/time", e),
  timeHour: (hour_start, activity) => post("/api/time/hour", { hour_start, activity }),
  timeEdit: (id, p) => patch(`/api/time/${id}`, p),
  timeDelete: id => del(`/api/time/${id}`),

  lists: () => get("/api/lists"),
  addList: name => post("/api/lists", { name }),
  renameList: (id, name) => patch(`/api/lists/${id}`, { name }),
  delList: id => del(`/api/lists/${id}`),
  clearCompleted: id => del(`/api/lists/${id}/completed`),

  captures: () => get("/api/captures"),
  addCapture: text => post("/api/captures", { text }),
  patchCapture: (id, p) => patch(`/api/captures/${id}`, p),
  delCapture: id => del(`/api/captures/${id}`),
  captureToTask: (id, p = {}) => post(`/api/captures/${id}/to-task`, p),

  habits: () => get("/api/habits"),
  addHabit: h => post("/api/habits", h),
  patchHabit: (id, p) => patch(`/api/habits/${id}`, p),
  delHabit: id => del(`/api/habits/${id}`),
  logHabit: (id, day, amount, note) => post(`/api/habits/${id}/logs`, { day, amount, note }),
  toggleHabit: (id, day) => post(`/api/habits/${id}/toggle`, { day }),
  delLog: id => del(`/api/habit-logs/${id}`),

  notifications: () => get("/api/notifications"),
  readNotifications: ids => post("/api/notifications/read", { ids }),
  clearNotifications: () => del("/api/notifications"),

  pushKey: () => get("/api/push/key"),
  pushSubs: () => get("/api/push/subscriptions"),
  pushSubscribe: (subscription, label) => post("/api/push/subscribe", { subscription, label }),
  pushUnsubscribe: p => post("/api/push/unsubscribe", p),
  report: (period, date) => get(`/api/report?period=${period}&date=${date}`),
  pushTest: delay => post("/api/push/test", delay ? { delay } : undefined),

  backups: () => get("/api/backups"),
  backupNow: () => post("/api/backups"),
};
