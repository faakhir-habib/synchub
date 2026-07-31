export function createUser(db, email, passwordHash, passwordSalt) {
  const info = db.prepare(
    "INSERT INTO users (email, password_hash, password_salt) VALUES (?, ?, ?)"
  ).run(email, passwordHash, passwordSalt);
  return findById(db, info.lastInsertRowid);
}

export function findByEmail(db, email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email);
}

export function findById(db, id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

export function setWebhook(db, id, url) {
  db.prepare("UPDATE users SET notify_webhook_url = ? WHERE id = ?").run(url, id);
  return findById(db, id);
}

// Update only the provided profile fields (name and/or webhook).
export function updateProfile(db, id, fields) {
  if (fields.name !== undefined) {
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(fields.name, id);
  }
  if (fields.notify_webhook_url !== undefined) {
    db.prepare("UPDATE users SET notify_webhook_url = ? WHERE id = ?").run(fields.notify_webhook_url, id);
  }
  return findById(db, id);
}
