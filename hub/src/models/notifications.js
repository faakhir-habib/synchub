export function record(db, { user_id, type, title, body = null }) {
  const info = db.prepare(
    "INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)"
  ).run(user_id, type, title, body);
  return db.prepare("SELECT * FROM notifications WHERE id = ?").get(info.lastInsertRowid);
}

export function listForUser(db, userId, limit = 50) {
  return db.prepare(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?"
  ).all(userId, limit);
}

export function unreadCount(db, userId) {
  return db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0").get(userId).n;
}

export function markRead(db, userId, id) {
  return db.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export function markAllRead(db, userId) {
  db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ?").run(userId);
}
