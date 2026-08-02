import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import * as users from "../src/models/users.js";
import * as sessions from "../src/models/sessions.js";
import * as machines from "../src/models/machines.js";

test("create user, find by email/id, reject duplicate", () => {
  const db = openDb(":memory:");
  const u = users.createUser(db, "a@b.com", "hash", "salt");
  assert.equal(u.email, "a@b.com");
  assert.equal(users.findByEmail(db, "a@b.com").id, u.id);
  assert.equal(users.findById(db, u.id).email, "a@b.com");
  assert.throws(() => users.createUser(db, "a@b.com", "h2", "s2"));
  db.close();
});

test("sessions map token to user and can be deleted", () => {
  const db = openDb(":memory:");
  const u = users.createUser(db, "a@b.com", "hash", "salt");
  const token = sessions.createSession(db, u.id);
  assert.equal(sessions.findUserByToken(db, token).id, u.id);
  sessions.deleteSession(db, token);
  assert.equal(sessions.findUserByToken(db, token), undefined);
  db.close();
});

test("machine CRUD is user-scoped and token unique", () => {
  const db = openDb(":memory:");
  const u1 = users.createUser(db, "u1@x.com", "h", "s");
  const u2 = users.createUser(db, "u2@x.com", "h", "s");
  const m = machines.create(db, u1.id, "Laptop");
  assert.ok(m.token.length > 0);
  assert.equal(machines.listForUser(db, u1.id).length, 1);
  assert.equal(machines.listForUser(db, u2.id).length, 0);
  assert.equal(machines.findByToken(db, m.token).id, m.id);
  machines.remove(db, u1.id, m.id);
  assert.equal(machines.listForUser(db, u1.id).length, 0);
  db.close();
});

test("pairing code issues then redeems into a machine token", () => {
  const db = openDb(":memory:");
  const u = users.createUser(db, "p@x.com", "h", "s");
  const code = machines.createPairingCode(db, u.id, 600);
  assert.match(code, /^[A-Z0-9]{6}$/);
  const m = machines.redeemPairingCode(db, code, { name: "Redeemed", os: "Windows" });
  assert.equal(m.name, "Redeemed");
  assert.ok(m.token);
  assert.equal(machines.redeemPairingCode(db, code, { name: "again" }), null); // consumed
  db.close();
});
