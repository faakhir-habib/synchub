import { Router } from "express";
import { requireUser } from "../lib/auth.js";
import * as projects from "../models/projects.js";
import * as mappings from "../models/mappings.js";
import * as machines from "../models/machines.js";
import * as conflicts from "../models/conflicts.js";
import * as fileState from "../models/fileState.js";
import * as events from "../models/events.js";
import { notifyUser } from "../lib/notify.js";

export function projectRoutes(db, store, realtime = null) {
  const r = Router();

  // List open conflicts for a project.
  r.get("/:id/conflicts", requireUser(db), (req, res) => {
    const p = projects.findOwned(db, req.user.id, Number(req.params.id));
    if (!p) return res.status(404).json({ error: "not found" });
    res.json(conflicts.listOpenForProject(db, p.id));
  });

  // Manual-mode "Sync now": ask every mapped agent to reconcile this project.
  r.post("/:id/sync-now", requireUser(db), (req, res) => {
    const p = projects.findOwned(db, req.user.id, Number(req.params.id));
    if (!p) return res.status(404).json({ error: "not found" });
    realtime?.triggerSync(p.id);
    events.record(db, { user_id: req.user.id, project_id: p.id, type: "sync_now" });
    res.json({ status: "triggered" });
  });

  // Resolve a conflict by keeping the "candidate" (pushed) or "canonical" version.
  r.post("/:id/conflicts/:conflictId/resolve", requireUser(db), (req, res) => {
    const p = projects.findOwned(db, req.user.id, Number(req.params.id));
    if (!p) return res.status(404).json({ error: "not found" });
    const c = conflicts.get(db, Number(req.params.conflictId));
    if (!c || c.project_id !== p.id || c.status !== "open") {
      return res.status(404).json({ error: "conflict not found" });
    }
    const choice = req.body?.choice === "canonical" ? "canonical" : "candidate";
    const candidateName = conflicts.candidateFilename(c.filename, c.candidate_hash);

    if (choice === "candidate") {
      const content = store.read(req.user.id, p.id, candidateName);
      if (content == null) return res.status(410).json({ error: "candidate content missing" });
      const size = Buffer.byteLength(content, "utf8");
      store.write(req.user.id, p.id, c.filename, content);
      fileState.upsert(db, p.id, c.filename, c.candidate_hash, size, c.machine_id);
      events.record(db, {
        user_id: req.user.id, project_id: p.id, machine_id: c.machine_id,
        type: "conflict_resolved", filename: c.filename, bytes: size,
      });
    } else {
      events.record(db, {
        user_id: req.user.id, project_id: p.id, type: "conflict_resolved", filename: c.filename,
      });
    }
    store.remove(req.user.id, p.id, candidateName);
    conflicts.resolve(db, c.id);
    notifyUser(db, realtime, {
      user_id: req.user.id, type: "sync",
      title: `Conflict resolved: ${c.filename}`, body: `Kept the ${choice} version.`,
    });
    // Fan the now-canonical content out to the project's other machines.
    if (choice === "candidate") {
      realtime?.notifyProjectChanged(p.id, { filename: c.filename, hash: c.candidate_hash });
    }
    res.json({ status: "resolved", choice });
  });

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

  // Update project settings (rename alias and/or change sync mode).
  r.put("/:id", requireUser(db), (req, res) => {
    const { alias, sync_mode } = req.body || {};
    if (alias !== undefined && !String(alias).trim()) return res.status(400).json({ error: "alias cannot be empty" });
    try {
      const p = projects.update(db, req.user.id, Number(req.params.id), {
        ...(alias !== undefined ? { alias: String(alias).trim() } : {}),
        ...(sync_mode !== undefined ? { sync_mode } : {}),
      });
      if (!p) return res.status(400).json({ error: "invalid project or sync_mode" });
      res.json(p);
    } catch {
      res.status(409).json({ error: "alias already exists" });
    }
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
