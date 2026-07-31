import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
