const MODES = ["auto", "manual", "stopped"];

export function create(db, userId, alias, syncMode = "auto") {
  const info = db.prepare(
    "INSERT INTO projects (user_id, alias, sync_mode) VALUES (?, ?, ?)"
  ).run(userId, alias, syncMode);
  return findById(db, info.lastInsertRowid);
}

export function findById(db, id) {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
}

export function findOwned(db, userId, id) {
  return db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(id, userId);
}

export function listForUser(db, userId) {
  return db.prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY created_at").all(userId);
}

// Update alias and/or sync_mode for an owned project. Returns null if not owned
// or invalid mode; throws on duplicate alias (caught by the route as 409).
export function update(db, userId, id, { alias, sync_mode }) {
  const p = findOwned(db, userId, id);
  if (!p) return null;
  if (sync_mode !== undefined && !MODES.includes(sync_mode)) return null;
  if (alias !== undefined && alias) db.prepare("UPDATE projects SET alias = ? WHERE id = ?").run(alias, id);
  if (sync_mode !== undefined) db.prepare("UPDATE projects SET sync_mode = ? WHERE id = ?").run(sync_mode, id);
  return findById(db, id);
}

export function setSyncMode(db, userId, id, mode) {
  if (!MODES.includes(mode)) return null;
  const p = findOwned(db, userId, id);
  if (!p) return null;
  db.prepare("UPDATE projects SET sync_mode = ? WHERE id = ?").run(mode, id);
  return findById(db, id);
}

export function remove(db, userId, id) {
  return db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export { MODES };
