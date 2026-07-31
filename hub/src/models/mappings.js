// Upsert a (project, machine) -> local_path mapping.
export function upsert(db, projectId, machineId, localPath) {
  db.prepare(
    `INSERT INTO mappings (project_id, machine_id, local_path) VALUES (?, ?, ?)
     ON CONFLICT (project_id, machine_id) DO UPDATE SET local_path = excluded.local_path`
  ).run(projectId, machineId, localPath);
  return db.prepare("SELECT * FROM mappings WHERE project_id = ? AND machine_id = ?").get(projectId, machineId);
}

export function listForProject(db, projectId) {
  return db.prepare("SELECT * FROM mappings WHERE project_id = ?").all(projectId);
}

// All projects this machine participates in, with mode + local path.
export function listForMachine(db, machineId) {
  return db.prepare(
    `SELECT m.project_id, m.local_path, p.alias, p.sync_mode
       FROM mappings m JOIN projects p ON p.id = m.project_id
      WHERE m.machine_id = ?
      ORDER BY p.alias`
  ).all(machineId);
}

export function get(db, projectId, machineId) {
  return db.prepare("SELECT * FROM mappings WHERE project_id = ? AND machine_id = ?")
    .get(projectId, machineId);
}

export function remove(db, projectId, machineId) {
  return db.prepare("DELETE FROM mappings WHERE project_id = ? AND machine_id = ?")
    .run(projectId, machineId).changes > 0;
}
