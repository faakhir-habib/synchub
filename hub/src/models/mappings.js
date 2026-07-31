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

export function remove(db, projectId, machineId) {
  return db.prepare("DELETE FROM mappings WHERE project_id = ? AND machine_id = ?")
    .run(projectId, machineId).changes > 0;
}
