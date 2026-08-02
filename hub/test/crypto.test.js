import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, randomToken } from "../src/lib/crypto.js";

test("hashPassword + verifyPassword round-trip", () => {
  const { hash, salt } = hashPassword("hunter2");
  assert.ok(hash.length > 0 && salt.length > 0);
  assert.equal(verifyPassword("hunter2", hash, salt), true);
  assert.equal(verifyPassword("wrong", hash, salt), false);
});

test("randomToken is unique and url-safe", () => {
  const a = randomToken();
  const b = randomToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.ok(a.length >= 32);
});
