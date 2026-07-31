import { Router } from "express";
import { requireMachine } from "../lib/auth.js";
import { hashContent } from "../lib/crypto.js";
import { isSafeFilename } from "../lib/relayStore.js";
import { autoMerge } from "../lib/merge.js";
import * as mappings from "../models/mappings.js";
import * as fileState from "../models/fileState.js";
import * as events from "../models/events.js";
import * as conflicts from "../models/conflicts.js";
import * as notifications from "../models/notifications.js";

// Agent-facing sync endpoints. Auth via X-Machine-Token (req.machine).
// `store` is a relay store instance (see lib/relayStore.js).
export function agentRoutes(db, store) {
  const r = Router();

  function touch(machine) {
    db.prepare("UPDATE machines SET last_seen_at = datetime('now'), status = 'online' WHERE id = ?")
      .run(machine.id);
  }

  // Require that req.machine is mapped into :projectId; returns the mapping or null.
  function requireMapping(req) {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId)) return null;
    return mappings.get(db, projectId, req.machine.id);
  }

  // What this machine should watch, and in what mode.
  r.get("/mappings", requireMachine(db), (req, res) => {
    touch(req.machine);
    res.json(mappings.listForMachine(db, req.machine.id));
  });

  // Canonical {filename, hash, size, updated_at} for every file in a project.
  r.get("/manifest/:projectId", requireMachine(db), (req, res) => {
    if (!requireMapping(req)) return res.status(404).json({ error: "not mapped to project" });
    touch(req.machine);
    res.json(fileState.listForProject(db, Number(req.params.projectId)));
  });

  // Download canonical content for one file.
  r.get("/pull/:projectId/:filename", requireMachine(db), (req, res) => {
    if (!requireMapping(req)) return res.status(404).json({ error: "not mapped to project" });
    const { projectId, filename } = req.params;
    if (!isSafeFilename(filename)) return res.status(400).json({ error: "invalid filename" });
    const content = store.read(req.machine.user_id, Number(projectId), filename);
    if (content == null) return res.status(404).json({ error: "not found" });
    res.type("application/x-ndjson").send(content);
  });

  // Push a local file. Body: { filename, content, base_hash }.
  // base_hash is the canonical hash the agent last knew (null if never synced).
  r.post("/push/:projectId", requireMachine(db), (req, res) => {
    if (!requireMapping(req)) return res.status(404).json({ error: "not mapped to project" });
    const projectId = Number(req.params.projectId);
    const { filename, content, base_hash = null } = req.body || {};
    if (!isSafeFilename(filename)) return res.status(400).json({ error: "invalid filename" });
    if (typeof content !== "string") return res.status(400).json({ error: "content required" });

    const current = fileState.get(db, projectId, filename);
    const newHash = hashContent(content);

    // No-op: agent already has the canonical version.
    if (current && current.hash === newHash) {
      touch(req.machine);
      return res.json({ status: "unchanged", hash: newHash });
    }

    // Divergence: agent's base is stale relative to canonical. Try to reconcile.
    if (current && base_hash !== current.hash) {
      const userId = req.machine.user_id;
      const canonicalContent = store.read(userId, projectId, filename) ?? "";
      const m = autoMerge(canonicalContent, content);

      // Incoming is behind canonical — nothing to do; tell the agent to pull.
      if (m.kind === "behind") {
        touch(req.machine);
        return res.json({ status: "behind", hash: current.hash });
      }

      // Forward extension or clean append-merge — write the result as canonical.
      if (m.kind === "forward" || m.kind === "merged") {
        const finalContent = m.merged;
        const finalHash = hashContent(finalContent);
        const finalSize = Buffer.byteLength(finalContent, "utf8");
        store.write(userId, projectId, filename, finalContent);
        fileState.upsert(db, projectId, filename, finalHash, finalSize, req.machine.id);
        events.record(db, {
          user_id: userId, machine_id: req.machine.id, project_id: projectId,
          type: m.kind === "merged" ? "auto_merge" : "push", filename, bytes: finalSize,
        });
        if (m.kind === "merged") {
          const c = conflicts.open(db, projectId, filename, req.machine.id, finalHash);
          conflicts.resolve(db, c.id);
          db.prepare("UPDATE conflicts SET auto_merged = 1 WHERE id = ?").run(c.id);
          notifications.record(db, {
            user_id: userId, type: "sync", title: `Auto-merged ${filename}`,
            body: `Diverging edits to ${filename} were merged automatically.`,
          });
        }
        touch(req.machine);
        return res.json({ status: m.kind === "merged" ? "merged" : "accepted", hash: finalHash });
      }

      // True conflict — park the candidate, open a conflict, notify. Canonical untouched.
      const candidateName = conflicts.candidateFilename(filename, newHash);
      store.write(userId, projectId, candidateName, content);
      const c = conflicts.open(db, projectId, filename, req.machine.id, newHash);
      notifications.record(db, {
        user_id: userId, type: "conflict", title: `Conflict in ${filename}`,
        body: `${filename} diverged and needs manual resolution.`,
      });
      events.record(db, {
        user_id: userId, machine_id: req.machine.id, project_id: projectId,
        type: "conflict", filename, bytes: Buffer.byteLength(content, "utf8"),
      });
      touch(req.machine);
      return res.status(409).json({ status: "conflict", conflictId: c.id });
    }

    // Forward update (first sync, or base matches canonical): accept and make canonical.
    store.write(req.machine.user_id, projectId, filename, content);
    const size = Buffer.byteLength(content, "utf8");
    fileState.upsert(db, projectId, filename, newHash, size, req.machine.id);
    events.record(db, {
      user_id: req.machine.user_id,
      machine_id: req.machine.id,
      project_id: projectId,
      type: "push",
      filename,
      bytes: size,
    });
    touch(req.machine);
    res.json({ status: "accepted", hash: newHash });
  });

  return r;
}
