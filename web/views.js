// The task views (what the sidebar's top section and each list show). This is the file to edit to try
// a different way of slicing tasks.
// Each view: { id, label, icon, tasks(all, today) -> tasks to consider, groups(tasks, today) -> [{ title, tasks }] }
// `today` is "YYYY-MM-DD" in the user's timezone. Subtasks are nested under parents by taskrow, not here.
import { dayOf, addDays } from "./time.js";

const open = t => !t.done_at;
const byDue = (a, b) => (a.due || "9").localeCompare(b.due || "9") || (a.due_time || "").localeCompare(b.due_time || "") || a.position - b.position;
const byDone = (a, b) => b.done_at.localeCompare(a.done_at);
const one = (tasks, title = "") => (tasks.length ? [{ title, tasks }] : []);

export const VIEWS = [
  {
    id: "myday", label: "My Day", icon: "☀",
    tasks: (all, today) => all.filter(t => (open(t) && t.due && t.due <= today) || (t.done_at && dayOf(t.done_at) === today)),
    groups: (tasks, today) => [
      { title: "Overdue", tasks: tasks.filter(t => open(t) && t.due < today).sort(byDue) },
      { title: "Today", tasks: tasks.filter(t => open(t) && t.due === today).sort(byDue) },
      { title: "Completed today", tasks: tasks.filter(t => !open(t)).sort(byDone), collapsed: true },
    ].filter(g => g.tasks.length),
  },
  {
    id: "upcoming", label: "Upcoming", icon: "📅",
    tasks: (all, today) => all.filter(t => open(t) && t.due && t.due > today),
    groups: (tasks, today) => [...new Set(tasks.map(t => t.due))].sort()
      .map(d => ({ title: d === addDays(today, 1) ? "Tomorrow" : d, date: d, tasks: tasks.filter(t => t.due === d).sort(byDue) })),
  },
  {
    id: "starred", label: "Starred", icon: "★",
    tasks: all => all.filter(t => open(t) && t.starred),
    groups: tasks => one(tasks.sort(byDue)),
  },
  {
    id: "all", label: "All tasks", icon: "☰",
    tasks: all => all.filter(open),
    groups: tasks => one(tasks.sort(byDue)),
  },
  {
    id: "done", label: "Completed", icon: "✓",
    tasks: all => all.filter(t => !open(t)),
    groups: tasks => one(tasks.sort(byDone)),
  },
];

// Sort modes for a list (Google Tasks: "My order", "Date", "Starred recently"...)
export const SORTS = {
  order: { label: "My order", fn: (a, b) => a.position - b.position || b.id - a.id },
  date: { label: "Date", fn: byDue },
  starred: { label: "Starred first", fn: (a, b) => b.starred - a.starred || a.position - b.position },
  title: { label: "Title", fn: (a, b) => a.title.localeCompare(b.title) },
};

// One view per list, generated for the sidebar. `sort` and `showDone` come from per-device preferences.
export const listView = (list, sort = "order") => ({
  id: "list/" + list.id, label: list.name, icon: "•", listId: list.id, sortable: true,
  tasks: all => all.filter(t => t.list_id === list.id),
  groups: tasks => [
    ...one(tasks.filter(open).sort(SORTS[sort].fn)),
    ...[{ title: "Completed", collapsed: true, tasks: tasks.filter(t => !open(t)).sort(byDone) }].filter(g => g.tasks.length),
  ],
});

// Put subtasks under their parent. A parent row always lists all its subtasks (done ones struck through).
// A subtask whose parent is NOT part of this view (e.g. a subtask due today under an undated parent) is shown
// on its own, with `parent` set so the row can say where it belongs.
export function arrange(shown, all, viewTasks = shown) {
  const inView = new Set(viewTasks.map(t => t.id));
  const byId = new Map(all.map(t => [t.id, t]));
  return shown.filter(t => !(t.parent_id && inView.has(t.parent_id))).map(t => ({
    task: t,
    subs: all.filter(s => s.parent_id === t.id).sort((a, b) => a.position - b.position || a.id - b.id),
    parent: t.parent_id ? byId.get(t.parent_id) : null,
  }));
}
