import { findUserByToken } from "../models/sessions.js";

// Express middleware factory: attaches req.user or 401s.
export function requireUser(db) {
  return (req, res, next) => {
    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    const user = token && findUserByToken(db, token);
    if (!user) return res.status(401).json({ error: "unauthorized" });
    req.user = user;
    req.sessionToken = token;
    next();
  };
}

// Machine-token middleware for agent-facing routes: attaches req.machine or 401s.
export function requireMachine(db) {
  return (req, res, next) => {
    const token = req.get("x-machine-token");
    const machine = token
      ? db.prepare("SELECT * FROM machines WHERE token = ?").get(token)
      : null;
    if (!machine) return res.status(401).json({ error: "unauthorized" });
    req.machine = machine;
    next();
  };
}
