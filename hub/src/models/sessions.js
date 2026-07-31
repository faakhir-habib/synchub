import { randomToken } from "../lib/crypto.js";

export function createSession(db, userId) {
  const token = randomToken();
  db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, userId);
  return token;
}

export function findUserByToken(db, token) {
  return db.prepare(
    "SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token = ?"
  ).get(token);
}

export function deleteSession(db, token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}
