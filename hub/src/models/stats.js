// Aggregates for the dashboard tiles — all scoped to one user, computed from
// the events table + current project/machine/conflict state.
export function dashboardMetrics(db, userId) {
  const projects = db.prepare(
    "SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN sync_mode != 'stopped' THEN 1 ELSE 0 END), 0) syncing FROM projects WHERE user_id = ?"
  ).get(userId);

  const machines = db.prepare(
    "SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END), 0) online FROM machines WHERE user_id = ?"
  ).get(userId);

  const openConflicts = db.prepare(
    "SELECT COUNT(*) n FROM conflicts c JOIN projects p ON p.id = c.project_id WHERE p.user_id = ? AND c.status = 'open'"
  ).get(userId).n;

  const today = db.prepare(
    "SELECT COUNT(*) events, COALESCE(SUM(bytes), 0) bytes FROM events WHERE user_id = ? AND date(created_at) = date('now')"
  ).get(userId);

  const sessionsToday = db.prepare(
    `SELECT COUNT(DISTINCT project_id || '/' || filename) n FROM events
      WHERE user_id = ? AND filename IS NOT NULL AND type IN ('push','auto_merge')
        AND date(created_at) = date('now')`
  ).get(userId).n;

  const week = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN type IN ('push','auto_merge') THEN 1 ELSE 0 END), 0) ok,
            COALESCE(SUM(CASE WHEN type = 'conflict' THEN 1 ELSE 0 END), 0) conflict
       FROM events WHERE user_id = ? AND created_at >= datetime('now','-7 days')`
  ).get(userId);
  const denom = week.ok + week.conflict;
  const successRate = denom > 0 ? Math.round((week.ok / denom) * 1000) / 10 : 100;

  const lat = db.prepare(
    "SELECT AVG(latency_ms) a FROM events WHERE user_id = ? AND latency_ms IS NOT NULL AND date(created_at) = date('now')"
  ).get(userId).a;

  const unread = db.prepare(
    "SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0"
  ).get(userId).n;

  return {
    projects: { total: projects.n, syncing: projects.syncing },
    machines: { total: machines.n, online: machines.online },
    openConflicts,
    eventsToday: today.events,
    dataTransferredBytes: today.bytes,
    sessionsSyncedToday: sessionsToday,
    syncSuccessRate: successRate,
    avgLatencyMs: lat != null ? Math.round(lat) : null,
    unreadNotifications: unread,
  };
}
