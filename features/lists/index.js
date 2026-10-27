import { db } from "../../core/db.js";
import { httpError } from "../../core/router.js";

export default {
  name: "lists",
  migrations: [
    `CREATE TABLE lists (
       id INTEGER PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
     INSERT INTO lists(name) VALUES ('My Tasks');`,
  ],
  routes: {
    "GET /api/lists": () => db.prepare("SELECT id, name FROM lists ORDER BY position, id").all(),
    "POST /api/lists": ({ body }) => {
      const name = String(body?.name ?? "").trim();
      if (!name) throw httpError(400, "Name required");
      const r = db.prepare("INSERT INTO lists(name) VALUES (?)").run(name);
      return { id: Number(r.lastInsertRowid), name };
    },
    "PATCH /api/lists/:id": ({ params, body }) => {
      const name = String(body?.name ?? "").trim();
      if (!name) throw httpError(400, "Name required");
      db.prepare("UPDATE lists SET name=? WHERE id=?").run(name, params.id);
      return { ok: true };
    },
    "DELETE /api/lists/:id": ({ params }) => {
      if (db.prepare("SELECT COUNT(*) c FROM lists").get().c <= 1) throw httpError(400, "Keep at least one list");
      db.prepare("DELETE FROM lists WHERE id=?").run(params.id); // its tasks are deleted too (ON DELETE CASCADE)
      return { ok: true };
    },
  },
};
