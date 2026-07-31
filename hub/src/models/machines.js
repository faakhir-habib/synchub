import { randomToken } from "../lib/crypto.js";
import { randomInt } from "node:crypto";

const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function sixCharCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return s;
}

export function create(db, userId, name, extra = {}) {
  const token = randomToken();
  const info = db.prepare(
    `INSERT INTO machines (user_id, name, token, os, os_version, label, agent_version)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, name, token, extra.os ?? null, extra.os_version ?? null, extra.label ?? null, extra.agent_version ?? null);
  return findById(db, info.lastInsertRowid);
}

export function findById(db, id) {
  return db.prepare("SELECT * FROM machines WHERE id = ?").get(id);
}

export function findByToken(db, token) {
  return db.prepare("SELECT * FROM machines WHERE token = ?").get(token);
}

export function listForUser(db, userId) {
  return db.prepare("SELECT * FROM machines WHERE user_id = ? ORDER BY created_at").all(userId);
}

export function remove(db, userId, id) {
  return db.prepare("DELETE FROM machines WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export function createPairingCode(db, userId, ttlSeconds = 600) {
  const code = sixCharCode();
  db.prepare(
    "INSERT INTO pairing_codes (code, user_id, expires_at) VALUES (?, ?, datetime('now', ?))"
  ).run(code, userId, `+${ttlSeconds} seconds`);
  return code;
}

// Redeems a valid, unexpired, unconsumed code -> creates a machine, consumes code.
export function redeemPairingCode(db, code, machineInfo = {}) {
  const row = db.prepare(
    "SELECT * FROM pairing_codes WHERE code = ? AND machine_id IS NULL AND expires_at > datetime('now')"
  ).get(code);
  if (!row) return null;
  const machine = create(db, row.user_id, machineInfo.name || "New machine", machineInfo);
  db.prepare("UPDATE pairing_codes SET machine_id = ? WHERE code = ?").run(machine.id, code);
  return machine;
}
