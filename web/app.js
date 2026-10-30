// App shell: login, sidebar, routing (#/route), keyboard shortcuts, polling. Pages live in pages/.
// To add a page: write pages/foo.js exporting a render function, add it to PAGES and (optionally) SIDEBAR_PAGES.
import { api } from "./api.js";
import { state, setRenderer, render, loadAll, leavePage } from "./state.js";
import { refreshNotifications } from "./actions.js";
import { actions } from "./actions.js";
import { h, toast, isTyping, undoLast, dismissToast } from "./ui.js";
import { showShortcuts } from "./shortcuts.js";
import { VIEWS } from "./views.js";
import { isoDay } from "./time.js";
import { renderTasks, allViews } from "./pages/tasks.js";
import { renderInbox, openCapture } from "./pages/inbox.js";
import { renderHabits, renderHabitPage, forgetHabitPage } from "./pages/habits.js";
import { renderCalendar } from "./pages/calendar.js";
import { renderProgress } from "./pages/progress.js";
import { renderNotifications, unreadCount } from "./pages/notifications.js";
import { renderSettings } from "./pages/settings.js";
import { renderTaskPage, forgetTaskPage } from "./taskdialog.js";
import { openAlarm } from "./alarm.js";

const root = document.getElementById("app");

const PAGES = { inbox: renderInbox, habits: renderHabits, calendar: renderCalendar, progress: renderProgress, notifications: renderNotifications, settings: renderSettings };
const SIDEBAR_PAGES = [
  { id: "inbox", label: "Inbox", icon: "📥", badge: () => state.captures.filter(c => c.status === "inbox").length },
  { id: "habits", label: "Habits & goals", icon: "🔁" },
  { id: "calendar", label: "Calendar", icon: "🗓" },
  { id: "progress", label: "Progress", icon: "📈" },
  { id: "notifications", label: "Notifications", icon: "🔔", badge: unreadCount, badgeId: "badge-notifications" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

// ---------- boot / login ----------
async function boot() {
  const s = await api.session();
  state.authEnabled = s.authEnabled;
  if (!s.authed) return renderLogin();
  try { await loadAll(); } catch (e) { return e.message === "UNAUTH" ? renderLogin() : root.replaceChildren(h("p", { class: "err" }, e.message)); }
  setRenderer(draw);
  onHash();
}

function renderLogin() {
  const err = h("p", { class: "err" });
  const pw = h("input", { type: "password", placeholder: "Password", autofocus: true, autocomplete: "current-password" });
  root.replaceChildren(h("form", {
    class: "login",
    onsubmit: async e => { e.preventDefault(); try { await api.login(pw.value); boot(); } catch (x) { err.textContent = x.message; } },
  }, h("h1", {}, "Daymark"), pw, h("button", { class: "primary" }, "Sign in"), err));
}
document.addEventListener("daymark:unauth", renderLogin);
document.addEventListener("daymark:logout", async () => {
  await api.logout().catch(() => {});
  try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* no cache API */ }
  location.hash = ""; location.reload();
});

// ---------- routing ----------
const DETAIL = /^(task|habit)\/\d+$/;
function onHash() {
  let raw = location.hash.replace(/^#\/?/, "") || "myday"; // opening the app always starts on My Day
  // a tapped reminder notification (#/alarm/<id>) shows the snooze popup over the last page
  const alarm = raw.match(/^alarm\/(\d+)$/);
  if (alarm) { raw = "myday"; history.replaceState(null, "", "#/" + raw); }
  state.route = raw; state.menu = false; state.navs++;
  forgetTaskPage(); forgetHabitPage();
  if (DETAIL.test(raw)) dismissToast(); // a toast would sit on top of the page's Save bar
  draw();
  document.getElementById("main")?.scrollTo(0, 0);
  if (alarm) openAlarm(Number(alarm[1]));
}
window.addEventListener("hashchange", onHash);
export const go = route => (location.hash = "#/" + route);

// ---------- drawing ----------
function navButton({ id, label, icon, count }) {
  return h("a", { class: "nav" + (state.route === id ? " active" : ""), href: "#/" + id },
    h("span", { class: "ico" }, icon), h("span", { class: "grow" }, label),
    count !== undefined && h("span", { class: "count", ...(id === "notifications" && { id: "badge-notifications" }), hidden: !count }, count || ""));
}

function draw() {
  const today = isoDay();
  const open = v => v.tasks(state.tasks, today).filter(t => !t.done_at).length;
  const views = allViews();

  const side = h("nav", { class: "side" + (state.menu ? " open" : "") },
    h("div", { class: "brand" }, "Daymark"),
    VIEWS.map(v => navButton({ id: v.id, label: v.label, icon: v.icon, count: v.id === "done" ? undefined : open(v) })),
    h("div", { class: "sep" }, "Lists"),
    state.lists.map(l => { const v = views.find(x => x.id === "list/" + l.id); return navButton({ id: v.id, label: l.name, icon: "•", count: open(v) }); }),
    h("button", { class: "nav muted", onclick: () => { const n = prompt("List name")?.trim(); if (n) actions.addList(n).then(l => l && go("list/" + l.id)); } },
      h("span", { class: "ico" }, "+"), "New list"),
    h("div", { class: "sep" }, "More"),
    SIDEBAR_PAGES.map(p => navButton({ id: p.id, label: p.label, icon: p.icon, count: p.badge?.() })));

  const detail = state.route.match(/^(task|habit)\/(\d+)$/);
  const page = detail ? (detail[1] === "task" ? renderTaskPage : renderHabitPage)(Number(detail[2]))
    : PAGES[state.route] ? PAGES[state.route]() : renderTasks(state.route);
  const keep = document.activeElement?.id;
  const keepRow = document.activeElement?.matches?.("li.task") ? document.activeElement.dataset.id : null;
  const scroll = document.getElementById("main")?.scrollTop ?? 0;
  const main = h("main", { id: "main", class: DETAIL.test(state.route) ? "detail" : "" }, page);
  root.replaceChildren(side, main, state.menu ? h("div", { class: "scrim", onclick: () => { state.menu = false; draw(); } }) : "");
  main.scrollTop = scroll;

  // keep typing flow: re-focus the box the user was in, otherwise focus the add box on desktop
  const again = keep && document.getElementById(keep);
  const row = keepRow && main.querySelector(`li.task[data-id="${keepRow}"]`);
  if (row) row.focus();
  else if (again) { again.focus(); if (again.setSelectionRange && again.type === "search") again.setSelectionRange(1e4, 1e4); }
  else if (matchMedia("(hover: hover)").matches && !document.querySelector("dialog[open]")) document.getElementById("add-input")?.focus();
  document.title = unreadCount() ? `(${unreadCount()}) Daymark` : "Daymark";
}

// ---------- keyboard ----------
document.addEventListener("keydown", e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === "/") { e.preventDefault(); showShortcuts(); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === "z" && !isTyping(e.target) && !document.querySelector("dialog[open]")) { if (undoLast()) e.preventDefault(); return; }
  if (DETAIL.test(state.route) && !isTyping(e.target) && e.key === "Escape") { leavePage(); return; }
  if (DETAIL.test(state.route) && !mod) return; // no list shortcuts on a detail page
  if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector("dialog[open]")) {
    if (e.key === "Escape" && e.target.id === "search-input") { state.query = ""; render(); }
    return;
  }
  if (e.key === "n") { e.preventDefault(); const el = document.getElementById("add-input"); el ? el.focus() : (go("myday"), setTimeout(() => document.getElementById("add-input")?.focus(), 50)); }
  if (e.key === "c") { e.preventDefault(); openCapture(); }
  if (e.key === "/") { e.preventDefault(); document.getElementById("search-input")?.focus(); }
});

// ---------- background refresh ----------
let lastSeen = 0;
async function poll() {
  if (document.hidden || !state.tasks) return;
  try {
    await refreshNotifications();
    const newest = state.notifications.filter(n => !n.read_at && n.id > lastSeen);
    if (lastSeen && newest.length) { toast("🔔 " + newest[0].title + (newest.length > 1 ? ` (+${newest.length - 1})` : "")); render(); }
    lastSeen = Math.max(lastSeen, ...state.notifications.map(n => n.id), 0);
    const badge = document.getElementById("badge-notifications");
    if (badge) { badge.textContent = unreadCount() || ""; badge.hidden = !unreadCount(); }
  } catch { /* offline or signed out: ignore */ }
}
setInterval(poll, 30_000);
document.addEventListener("visibilitychange", async () => {
  if (document.hidden || !state.lists.length) return;
  try {
    await loadAll();
    lastSeen = Math.max(lastSeen, ...state.notifications.map(n => n.id), 0);
    const typing = isTyping(document.activeElement) && document.activeElement.value;
    if (!document.querySelector("dialog[open]") && !typing) render();
  } catch { /* ignore */ }
});

navigator.serviceWorker?.addEventListener("message", e => {
  if (e.data?.type === "tasks-changed") loadAll().then(render).catch(() => {});
});

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("/sw.js").catch(() => {});
boot().then(() => { lastSeen = Math.max(0, ...state.notifications.map(n => n.id)); });
