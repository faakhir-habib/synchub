import { Router } from "express";
import { hashPassword, verifyPassword } from "../lib/crypto.js";
import * as users from "../models/users.js";
import * as sessions from "../models/sessions.js";
import { requireUser } from "../lib/auth.js";

export function authRoutes(db) {
  const r = Router();

  r.post("/signup", (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: "email and password (>=6 chars) required" });
    }
    if (users.findByEmail(db, email)) {
      return res.status(409).json({ error: "email already registered" });
    }
    const { hash, salt } = hashPassword(password);
    const user = users.createUser(db, email, hash, salt);
    const token = sessions.createSession(db, user.id);
    res.status(201).json({ token, user: { id: user.id, email: user.email } });
  });

  r.post("/login", (req, res) => {
    const { email, password } = req.body || {};
    const user = email && users.findByEmail(db, email);
    if (!user || !verifyPassword(password || "", user.password_hash, user.password_salt)) {
      return res.status(401).json({ error: "invalid credentials" });
    }
    const token = sessions.createSession(db, user.id);
    res.json({ token, user: { id: user.id, email: user.email } });
  });

  r.post("/logout", requireUser(db), (req, res) => {
    sessions.deleteSession(db, req.sessionToken);
    res.json({ ok: true });
  });

  const publicUser = (u) => ({
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    notify_webhook_url: u.notify_webhook_url,
    notify_conflicts: u.notify_conflicts !== 0,
    notify_sync: u.notify_sync !== 0,
  });

  r.get("/me", requireUser(db), (req, res) => {
    res.json(publicUser(req.user));
  });

  // Update profile — accepts any of { name, notify_webhook_url, notify_conflicts, notify_sync }.
  r.put("/me", requireUser(db), (req, res) => {
    const b = req.body || {};
    const fields = {};
    if ("name" in b) fields.name = (b.name ?? "").toString().slice(0, 120) || null;
    if ("notify_webhook_url" in b) fields.notify_webhook_url = b.notify_webhook_url || null;
    if ("notify_conflicts" in b) fields.notify_conflicts = b.notify_conflicts ? 1 : 0;
    if ("notify_sync" in b) fields.notify_sync = b.notify_sync ? 1 : 0;
    const u = users.updateProfile(db, req.user.id, fields);
    res.json(publicUser(u));
  });

  r.put("/me/notify-webhook", requireUser(db), (req, res) => {
    const updated = users.setWebhook(db, req.user.id, req.body?.url ?? null);
    res.json({ notify_webhook_url: updated.notify_webhook_url });
  });

  return r;
}
