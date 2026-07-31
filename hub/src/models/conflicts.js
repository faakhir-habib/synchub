export function open(db, projectId, filename, machineId, candidateHash) {
  const info = db.prepare(
    `INSERT INTO conflicts (project_id, filename, machine_id, candidate_hash, auto_merged, status)
     VALUES (?, ?, ?, ?, 0, 'open')`
  ).run(projectId, filename, machineId, candidateHash);
  return get(db, info.lastInsertRowid);
}

export function get(db, id) {
  return db.prepare("SELECT * FROM conflicts WHERE id = ?").get(id);
}

export function listOpenForProject(db, projectId) {
  return db.prepare(
    "SELECT * FROM conflicts WHERE project_id = ? AND status = 'open' ORDER BY created_at DESC"
  ).all(projectId);
}

// All open conflicts for a user (across their projects), with project alias.
export function listOpenForUser(db, userId) {
  return db.prepare(
    `SELECT c.*, p.alias AS project_alias
       FROM conflicts c JOIN projects p ON p.id = c.project_id
      WHERE p.user_id = ? AND c.status = 'open'
      ORDER BY c.created_at DESC`
  ).all(userId);
}

export function resolve(db, id) {
  db.prepare("UPDATE conflicts SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?").run(id);
  return get(db, id);
}

// Candidate content is parked in the relay store under this derived name.
export function candidateFilename(filename, candidateHash) {
  return `${filename}.cand.${candidateHash.slice(0, 12)}`;
}
