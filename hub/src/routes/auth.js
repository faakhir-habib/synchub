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

  r.get("/me", requireUser(db), (req, res) => {
    res.json({ id: req.user.id, email: req.user.email, notify_webhook_url: req.user.notify_webhook_url });
  });

  r.put("/me/notify-webhook", requireUser(db), (req, res) => {
    const updated = users.setWebhook(db, req.user.id, req.body?.url ?? null);
    res.json({ notify_webhook_url: updated.notify_webhook_url });
  });

  return r;
}
