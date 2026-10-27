import { db } from "../../core/db.js";
import { httpError } from "../../core/router.js";
import { events } from "../../core/events.js";
import { dayIn, nextOccurrence, nextRuleFor, sameSchedule, validDay, validRule, validTime } from "../../core/time.js";
import { getSetting } from "../settings/index.js";

// Dates are plain strings in the user's timezone: due "YYYY-MM-DD", due_time "HH:MM".
// Subtasks: parent_id (one level only). Soft delete: deleted_at (enables Undo; purged after 30 days).
// Repeating: `repeat` is a JSON rule (see validRule); completing a repeating task creates the next one (history is kept).
// `series_due` is where the schedule is, so moving one occurrence's date doesn't shift the series; editing the
// repeat pattern restarts it from that task's date. Like Google Tasks: repeating tasks have no subtasks and stay in their list.
const ser = r => r && { ...r, repeat: r.repeat ? JSON.parse(r.repeat) : null };
const live = id => db.prepare("SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL").get(id);
const must = id => live(id) ?? (() => { throw httpError(404, "Task not found"); })();
const today = () => dayIn(getSetting("timezone"));

function check(fields) {
  const out = {};
  if ("title" in fields) {
    out.title = String(fields.title ?? "").trim().slice(0, 240);
    if (!out.title) throw httpError(400, "Title required");
  }
  if ("notes" in fields) out.notes = String(fields.notes ?? "").slice(0, 10000);
  if ("due" in fields) {
    if (fields.due && !validDay(fields.due)) throw httpError(400, "Bad date");
    out.due = fields.due || null;
  }
  if ("due_time" in fields) {
    if (fields.due_time && !validTime(fields.due_time)) throw httpError(400, "Bad time");
    out.due_time = fields.due_time || null;
  }
  if ("repeat" in fields) {
    out.repeat = fields.repeat ? JSON.stringify(validRule(fields.repeat) ?? (() => { throw httpError(400, "Bad repeat"); })()) : null;
  }
  if ("series_due" in fields && validDay(fields.series_due)) out.series_due = fields.series_due;
  if ("starred" in fields) out.starred = fields.starred ? 1 : 0;
  if ("list_id" in fields) {
    if (!db.prepare("SELECT 1 FROM lists WHERE id=?").get(fields.list_id)) throw httpError(400, "List not found");
    out.list_id = Number(fields.list_id);
  }
  if ("position" in fields) out.position = Number(fields.position) || 0;
  if ("parent_id" in fields) out.parent_id = fields.parent_id ? Number(fields.parent_id) : null;
  return out;
}

function normalise(out, current = {}) {
  const due = "due" in out ? out.due : current.due;
  if (!due) { out.due_time = null; if ("repeat" in out || current.repeat) out.repeat = null; }
  return out;
}

export function createTask(fields, { trusted = false } = {}) {
  const out = check(Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== undefined && !(k === "list_id" && v === null))));
  if (!out.title) throw httpError(400, "Title required");
  if (out.parent_id) {
    const p = must(out.parent_id);
    if (p.parent_id) throw httpError(400, "Subtasks can't have subtasks");
    if (p.repeat && !trusted) throw httpError(400, "Repeating tasks can't have subtasks");
    out.list_id = p.list_id;
    out.repeat = null; // subtasks never repeat
  }
  out.list_id ??= db.prepare("SELECT id FROM lists ORDER BY position, id LIMIT 1").get().id;
  if (out.repeat && !out.due) out.due = today();
  normalise(out);
  if (out.repeat) out.series_due ??= out.due;
  else delete out.series_due;
  out.position ??= out.parent_id
    ? db.prepare("SELECT COALESCE(MAX(position),0)+1 p FROM tasks WHERE parent_id=?").get(out.parent_id).p
    : db.prepare("SELECT COALESCE(MIN(position),0)-1 p FROM tasks WHERE list_id=? AND parent_id IS NULL").get(out.list_id).p;
  const keys = Object.keys(out);
  const r = db.prepare(`INSERT INTO tasks(${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map(k => out[k]));
  return ser(db.prepare("SELECT * FROM tasks WHERE id=?").get(r.lastInsertRowid));
}

const childrenOf = id => db.prepare("SELECT id FROM tasks WHERE parent_id=? AND deleted_at IS NULL").all(id).map(r => r.id);

export default {
  name: "tasks",
  migrations: [
    `CREATE TABLE tasks (
       id INTEGER PRIMARY KEY,
       list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
       parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
       title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
       due TEXT, starred INTEGER NOT NULL DEFAULT 0,
       done_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
     CREATE INDEX tasks_due ON tasks(due);`,
    `ALTER TABLE tasks ADD COLUMN due_time TEXT;
     ALTER TABLE tasks ADD COLUMN repeat TEXT;
     ALTER TABLE tasks ADD COLUMN position REAL NOT NULL DEFAULT 0;
     ALTER TABLE tasks ADD COLUMN deleted_at TEXT;`,
    `ALTER TABLE tasks ADD COLUMN series_due TEXT;
     UPDATE tasks SET series_due = due WHERE repeat IS NOT NULL;`,
  ],
  routes: {
    // Single user, at most a few thousand tasks: send everything, let the browser filter.
    "GET /api/tasks": () => db.prepare("SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY position, id DESC").all().map(ser),

    "POST /api/tasks": ({ body }) => createTask(body ?? {}),

    "PATCH /api/tasks/:id": ({ params, body }) => {
      const cur = must(params.id);
      const out = check(body ?? {});
      if (!Object.keys(out).length) throw httpError(400, "Nothing to update");
      if ("parent_id" in out && out.parent_id) {
        const p = must(out.parent_id);
        if (p.id === cur.id || p.parent_id) throw httpError(400, "Invalid parent");
        if (childrenOf(cur.id).length) throw httpError(400, "A task with subtasks can't become a subtask");
        out.list_id = p.list_id;
        if (p.repeat) throw httpError(400, "Repeating tasks can't have subtasks");
        out.repeat = null; // subtasks never repeat
      }
      if (out.repeat && childrenOf(cur.id).length) throw httpError(400, "Tasks with subtasks can't repeat");
      normalise(out, ser(cur));
      if (out.repeat && !(out.due ?? cur.due)) out.due = today();
      if ("list_id" in out && out.list_id !== cur.list_id && ("repeat" in out ? out.repeat : cur.repeat))
        throw httpError(400, "Repeating tasks can't be moved to another list");
      if ("repeat" in out) {
        if (!out.repeat) out.series_due = null;
        else if (!cur.series_due || !sameSchedule(JSON.parse(out.repeat), cur.repeat && JSON.parse(cur.repeat)))
          out.series_due = out.due ?? cur.due; // new pattern: the series restarts from this task's date
      }
      const keys = Object.keys(out);
      db.prepare(`UPDATE tasks SET ${keys.map(k => k + "=?").join(",")} WHERE id=?`).run(...keys.map(k => out[k]), cur.id);
      if ("list_id" in out) db.prepare("UPDATE tasks SET list_id=? WHERE parent_id=?").run(out.list_id, cur.id);
      events.emit("task:changed", cur.id);
      return ser(live(cur.id));
    },

    "POST /api/tasks/:id/complete": ({ params }) => {
      const t = must(params.id);
      if (t.done_at) return { task: ser(t), next: null };
      const now = new Date().toISOString();
      db.prepare("UPDATE tasks SET done_at=? WHERE id=?").run(now, t.id);
      let next = null;
      if (t.repeat && !t.parent_id) {
        const rule = JSON.parse(t.repeat);
        // From the series schedule, not the (possibly moved) due date of this occurrence.
        const nextDue = nextOccurrence(rule, t.series_due || t.due || today(), today());
        const nextRule = nextRuleFor(rule, nextDue);
        if (nextRule) {
          next = createTask({
            title: t.title, notes: t.notes, list_id: t.list_id, starred: t.starred, repeat: nextRule,
            due: nextDue, series_due: nextDue, due_time: t.due_time, position: t.position,
          }, { trusted: true });
          // only tasks that repeated before subtasks were disallowed can still have them
          for (const sub of db.prepare("SELECT title, notes FROM tasks WHERE parent_id=? AND deleted_at IS NULL ORDER BY position").all(t.id))
            createTask({ title: sub.title, notes: sub.notes, parent_id: next.id }, { trusted: true });
          events.emit("task:recurred", { from: t.id, to: next.id });
        }
      }
      events.emit("task:changed", t.id);
      return { task: ser(live(t.id)), next };
    },

    // body.remove_id: the follow-up copy that complete() made, deleted again when undoing a repeating completion.
    "POST /api/tasks/:id/reopen": ({ params, body }) => {
      const t = must(params.id);
      db.prepare("UPDATE tasks SET done_at=NULL WHERE id=?").run(t.id);
      if (body?.remove_id && t.repeat) db.prepare("DELETE FROM tasks WHERE id=? AND done_at IS NULL AND title=?").run(body.remove_id, t.title);
      events.emit("task:changed", t.id);
      return ser(live(t.id));
    },

    "DELETE /api/tasks/:id": ({ params }) => {
      const t = must(params.id);
      const ids = [t.id, ...childrenOf(t.id)];
      const now = new Date().toISOString();
      for (const id of ids) db.prepare("UPDATE tasks SET deleted_at=? WHERE id=?").run(now, id);
      ids.forEach(id => events.emit("task:changed", id));
      return { ok: true };
    },
    "POST /api/tasks/:id/restore": ({ params }) => {
      const t = db.prepare("SELECT * FROM tasks WHERE id=?").get(params.id);
      if (!t) throw httpError(404, "Task not found");
      db.prepare("UPDATE tasks SET deleted_at=NULL WHERE id=? OR parent_id=?").run(t.id, t.id);
      db.prepare("SELECT id FROM tasks WHERE id=? OR parent_id=?").all(t.id, t.id).forEach(r => events.emit("task:changed", r.id));
      return db.prepare("SELECT * FROM tasks WHERE (id=? OR parent_id=?) AND deleted_at IS NULL").all(t.id, t.id).map(ser);
    },

    // body.ids = task ids in their new order ("My order" sorting by drag and drop)
    "POST /api/tasks/reorder": ({ body }) => {
      if (!Array.isArray(body?.ids)) throw httpError(400, "ids required");
      body.ids.forEach((id, i) => db.prepare("UPDATE tasks SET position=? WHERE id=?").run(i, id));
      return { ok: true };
    },

    // "Delete all completed tasks" in a list
    "DELETE /api/lists/:id/completed": ({ params }) => {
      const r = db.prepare("DELETE FROM tasks WHERE list_id=? AND done_at IS NOT NULL AND deleted_at IS NULL").run(params.id);
      return { deleted: Number(r.changes) };
    },
  },
  start() {
    db.prepare("DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?").run(new Date(Date.now() - 30 * 864e5).toISOString());
  },
};
