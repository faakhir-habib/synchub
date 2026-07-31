// Append an event row. Feeds dashboard metrics + activity timeline (Phase 5).
export function record(db, { user_id, machine_id = null, project_id = null, type, filename = null, bytes = 0, latency_ms = null }) {
  db.prepare(
    `INSERT INTO events (user_id, machine_id, project_id, type, filename, bytes, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(user_id, machine_id, project_id, type, filename, bytes, latency_ms);
}

export function recent(db, userId, limit = 20) {
  return db.prepare(
    "SELECT * FROM events WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?"
  ).all(userId, limit);
}

export function recentForProject(db, projectId, limit = 10) {
  return db.prepare(
    "SELECT * FROM events WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?"
  ).all(projectId, limit);
}
