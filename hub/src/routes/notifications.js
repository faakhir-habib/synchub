import { Router } from "express";
import { requireUser } from "../lib/auth.js";
import * as notifications from "../models/notifications.js";

export function notificationRoutes(db) {
  const r = Router();

  r.get("/", requireUser(db), (req, res) => {
    res.json({
      items: notifications.listForUser(db, req.user.id),
      unread: notifications.unreadCount(db, req.user.id),
    });
  });

  r.post("/:id/read", requireUser(db), (req, res) => {
    const ok = notifications.markRead(db, req.user.id, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  });

  r.post("/read-all", requireUser(db), (req, res) => {
    notifications.markAllRead(db, req.user.id);
    res.json({ ok: true });
  });

  return r;
}
