// Quick Capture: a thought inbox. Capture now, later turn into a task, edit, archive or delete.
import { db } from "../../core/db.js";
import { httpError } from "../../core/router.js";
import { createTask } from "../tasks/index.js";

const get = id => db.prepare("SELECT * FROM captures WHERE id=?").get(id) ?? (() => { throw httpError(404, "Not found"); })();

export default {
  name: "captures",
  migrations: [
    `CREATE TABLE captures (
       id INTEGER PRIMARY KEY, text TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox','archived')),
       task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
       created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));`,
  ],
  routes: {
    "GET /api/captures": () => db.prepare("SELECT * FROM captures ORDER BY id DESC LIMIT 1000").all(),
    "POST /api/captures": ({ body }) => {
      const text = String(body?.text ?? "").trim().slice(0, 5000);
      if (!text) throw httpError(400, "Write something first");
      return get(db.prepare("INSERT INTO captures(text) VALUES (?)").run(text).lastInsertRowid);
    },
    "PATCH /api/captures/:id": ({ params, body }) => {
      const c = get(params.id);
      const text = "text" in (body ?? {}) ? String(body.text).trim().slice(0, 5000) : c.text;
      const status = body?.status ?? c.status;
      if (!text || !["inbox", "archived"].includes(status)) throw httpError(400, "Invalid capture");
      db.prepare("UPDATE captures SET text=?, status=? WHERE id=?").run(text, status, c.id);
      return get(c.id);
    },
    "DELETE /api/captures/:id": ({ params }) => { db.prepare("DELETE FROM captures WHERE id=?").run(params.id); return { ok: true }; },
    // Turn a capture into a task. First line = title, the rest = details. The capture is archived and linked.
    "POST /api/captures/:id/to-task": ({ params, body }) => {
      const c = get(params.id);
      const [first, ...rest] = c.text.split("\n");
      const task = createTask({ title: first.slice(0, 240), notes: rest.join("\n").trim(), list_id: body?.list_id, due: body?.due });
      db.prepare("UPDATE captures SET status='archived', task_id=? WHERE id=?").run(task.id, c.id);
      return { task, capture: get(c.id) };
    },
  },
};
