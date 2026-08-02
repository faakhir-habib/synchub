import { Router } from "express";
import { requireUser } from "../lib/auth.js";
import * as conflicts from "../models/conflicts.js";

// Top-level view: every open conflict across the user's projects (drives the
// Conflicts page + sidebar count).
export function conflictRoutes(db) {
  const r = Router();
  r.get("/", requireUser(db), (req, res) => {
    res.json(conflicts.listOpenForUser(db, req.user.id));
  });
  return r;
}
