// SQLite via Node's built-in driver (no npm packages needed).
// Each feature owns its tables: it exports `migrations: [sql, sql, ...]`.
// Migrations run once, in order, tracked per feature. Never edit an applied one; append a new one.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const dataDir = process.env.DATA_DIR || "./data";
fs.mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, "daymark.sqlite"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec("CREATE TABLE IF NOT EXISTS _migrations (feature TEXT, n INTEGER, PRIMARY KEY (feature, n))");

export function migrate(feature, migrations = []) {
  migrations.forEach((sql, n) => {
    if (db.prepare("SELECT 1 FROM _migrations WHERE feature=? AND n=?").get(feature, n)) return;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations VALUES (?,?)").run(feature, n);
      db.exec("COMMIT");
      console.log(`migrated ${feature}#${n}`);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
}
