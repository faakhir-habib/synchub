import { Router } from "express";
import { requireUser } from "../lib/auth.js";
import * as projects from "../models/projects.js";
import * as mappings from "../models/mappings.js";
import * as machines from "../models/machines.js";

export function projectRoutes(db) {
  const r = Router();

  r.get("/", requireUser(db), (req, res) => {
    res.json(projects.listForUser(db, req.user.id));
  });

  r.post("/", requireUser(db), (req, res) => {
    const { alias, sync_mode } = req.body || {};
    if (!alias) return res.status(400).json({ error: "alias required" });
    if (sync_mode && !projects.MODES.includes(sync_mode)) {
      return res.status(400).json({ error: "invalid sync_mode" });
    }
    try {
      const p = projects.create(db, req.user.id, alias, sync_mode || "auto");
      res.status(201).json(p);
    } catch (e) {
      res.status(409).json({ error: "alias already exists" });
    }
  });

  r.get("/:id", requireUser(db), (req, res) => {
    const p = projects.findOwned(db, req.user.id, Number(req.params.id));
    if (!p) return res.status(404).json({ error: "not found" });
    res.json({ ...p, mappings: mappings.listForProject(db, p.id) });
  });

  r.put("/:id/sync-mode", requireUser(db), (req, res) => {
    const p = projects.setSyncMode(db, req.user.id, Number(req.params.id), req.body?.sync_mode);
    if (!p) return res.status(400).json({ error: "invalid project or sync_mode" });
    res.json(p);
  });

  r.put("/:id/mappings/:machineId", requireUser(db), (req, res) => {
    const p = projects.findOwned(db, req.user.id, Number(req.params.id));
    if (!p) return res.status(404).json({ error: "project not found" });
    const m = machines.findById(db, Number(req.params.machineId));
    if (!m || m.user_id !== req.user.id) return res.status(404).json({ error: "machine not found" });
    if (!req.body?.local_path) return res.status(400).json({ error: "local_path required" });
    res.json(mappings.upsert(db, p.id, m.id, req.body.local_path));
  });

  r.delete("/:id/mappings/:machineId", requireUser(db), (req, res) => {
    const p = projects.findOwned(db, req.user.id, Number(req.params.id));
    if (!p) return res.status(404).json({ error: "project not found" });
    const ok = mappings.remove(db, p.id, Number(req.params.machineId));
    if (!ok) return res.status(404).json({ error: "mapping not found" });
    res.json({ ok: true });
  });

  r.delete("/:id", requireUser(db), (req, res) => {
    const ok = projects.remove(db, req.user.id, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  });

  return r;
}
