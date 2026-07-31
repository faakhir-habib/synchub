import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";

test("schema creates all expected tables", () => {
  const db = openDb(":memory:");
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map((r) => r.name);
  for (const t of ["users","sessions","machines","pairing_codes","projects","mappings","file_state","conflicts","notifications","events"]) {
    assert.ok(rows.includes(t), `missing table: ${t}`);
  }
  db.close();
});
