import { Router } from "express";
import { requireUser } from "../lib/auth.js";
import * as stats from "../models/stats.js";
import * as events from "../models/events.js";

export function dashboardRoutes(db) {
  const r = Router();

  r.get("/metrics", requireUser(db), (req, res) => {
    res.json(stats.dashboardMetrics(db, req.user.id));
  });

  r.get("/activity", requireUser(db), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    res.json(events.recent(db, req.user.id, limit));
  });

  return r;
}
