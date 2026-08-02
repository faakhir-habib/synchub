import { Router } from "express";
import { requireUser } from "../lib/auth.js";
import * as machines from "../models/machines.js";

// Strips the secret token from a machine row for list/detail responses.
function publicMachine(m) {
  const { token, user_id, ...rest } = m;
  return rest;
}

export function machineRoutes(db) {
  const r = Router();

  r.get("/", requireUser(db), (req, res) => {
    res.json(machines.listForUser(db, req.user.id).map(publicMachine));
  });

  r.post("/", requireUser(db), (req, res) => {
    const { name, os, os_version, label } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    const m = machines.create(db, req.user.id, name, { os, os_version, label });
    res.status(201).json({ ...publicMachine(m), token: m.token }); // token shown once
  });

  r.delete("/:id", requireUser(db), (req, res) => {
    const ok = machines.remove(db, req.user.id, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  });

  r.post("/pair", requireUser(db), (req, res) => {
    const code = machines.createPairingCode(db, req.user.id, 600);
    res.status(201).json({ code, expires_in: 600 });
  });

  return r;
}

// Unauthenticated agent-facing redeem (mounted under /api/agent).
export function pairRedeemRoutes(db) {
  const r = Router();
  r.post("/pair/redeem", (req, res) => {
    const { code, name, os, os_version, label, agent_version } = req.body || {};
    const m = code && machines.redeemPairingCode(db, code, { name, os, os_version, label, agent_version });
    if (!m) return res.status(400).json({ error: "invalid or expired code" });
    res.status(201).json({ machineToken: m.token, machineId: m.id });
  });
  return r;
}
