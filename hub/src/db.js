import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Pass ":memory:" in tests, or a file path in production.
// Uses Node's built-in node:sqlite (DatabaseSync) — no native build step.
export function openDb(path = process.env.DB_PATH || join(__dirname, "..", "data", "synchub.sqlite")) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
  // Lightweight migrations (idempotent — ignore "duplicate column" on re-run).
  for (const mig of [
    "ALTER TABLE users ADD COLUMN name TEXT",
    "ALTER TABLE users ADD COLUMN notify_conflicts INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE users ADD COLUMN notify_sync INTEGER NOT NULL DEFAULT 1",
  ]) {
    try { db.exec(mig); } catch { /* already applied */ }
  }
  return db;
}
