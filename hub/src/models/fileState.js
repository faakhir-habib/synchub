// Canonical per-file sync state: one row per (project_id, filename).
export function get(db, projectId, filename) {
  return db.prepare(
    "SELECT * FROM file_state WHERE project_id = ? AND filename = ?"
  ).get(projectId, filename);
}

export function listForProject(db, projectId) {
  return db.prepare(
    "SELECT filename, hash, size, updated_at FROM file_state WHERE project_id = ? ORDER BY filename"
  ).all(projectId);
}

// Insert or update the canonical hash/size/writer for a file.
export function upsert(db, projectId, filename, hash, size, machineId) {
  db.prepare(
    `INSERT INTO file_state (project_id, filename, hash, size, last_machine_id, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (project_id, filename) DO UPDATE SET
       hash = excluded.hash,
       size = excluded.size,
       last_machine_id = excluded.last_machine_id,
       updated_at = datetime('now')`
  ).run(projectId, filename, hash, size, machineId);
  return get(db, projectId, filename);
}
