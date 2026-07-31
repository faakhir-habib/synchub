import { WebSocketServer } from "ws";
import { findUserByToken } from "../models/sessions.js";
import * as machinesModel from "../models/machines.js";
import * as mappings from "../models/mappings.js";

// Live relay: agents connect at /ws/agent?token=<machine_token>, browser UIs at
// /ws/user?token=<session_token>. Routes call the returned broker methods to fan
// changes out to other machines and push notifications to the owning user.
export function createRealtime(db) {
  const agentsByMachine = new Map(); // machineId -> Set<ws>
  const usersByUser = new Map();     // userId    -> Set<ws>

  function add(map, key, ws) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(ws);
  }
  function remove(map, key, ws) {
    const s = map.get(key);
    if (s) { s.delete(ws); if (!s.size) map.delete(key); }
  }
  function sendTo(set, obj) {
    if (!set) return;
    const msg = JSON.stringify(obj);
    for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(msg);
  }
  function setMachineStatus(machineId, status) {
    db.prepare("UPDATE machines SET status = ?, last_seen_at = datetime('now') WHERE id = ?")
      .run(status, machineId);
  }

  function onAgent(ws) {
    const m = ws._machine;
    add(agentsByMachine, m.id, ws);
    setMachineStatus(m.id, "online");
    ws.send(JSON.stringify({ type: "welcome", machineId: m.id }));
    ws.on("message", () => { /* heartbeat/ping — presence is the connection itself */ });
    ws.on("close", () => {
      remove(agentsByMachine, m.id, ws);
      if (!agentsByMachine.has(m.id)) setMachineStatus(m.id, "offline");
    });
  }
  function onUser(ws) {
    const u = ws._user;
    add(usersByUser, u.id, ws);
    ws.send(JSON.stringify({ type: "welcome", userId: u.id }));
    ws.on("close", () => remove(usersByUser, u.id, ws));
  }

  return {
    attach(server) {
      const wss = new WebSocketServer({ noServer: true });
      server.on("upgrade", (req, socket, head) => {
        let url;
        try { url = new URL(req.url, "http://localhost"); } catch { socket.destroy(); return; }
        const token = url.searchParams.get("token");
        if (url.pathname === "/ws/agent") {
          const machine = token && machinesModel.findByToken(db, token);
          if (!machine) { socket.destroy(); return; }
          wss.handleUpgrade(req, socket, head, (ws) => { ws._machine = machine; onAgent(ws); });
        } else if (url.pathname === "/ws/user") {
          const user = token && findUserByToken(db, token);
          if (!user) { socket.destroy(); return; }
          wss.handleUpgrade(req, socket, head, (ws) => { ws._user = user; onUser(ws); });
        } else {
          socket.destroy();
        }
      });
      this._wss = wss;
    },

    // Tell other online agents mapped to an AUTO-mode project to pull a change.
    notifyProjectChanged(projectId, { filename, hash, excludeMachineId = null } = {}) {
      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
      if (!project || project.sync_mode !== "auto") return;
      for (const row of mappings.listForProject(db, projectId)) {
        if (row.machine_id === excludeMachineId) continue;
        sendTo(agentsByMachine.get(row.machine_id), { type: "changed", projectId, filename, hash });
      }
    },

    // Manual-mode "Sync now": tell all mapped agents to reconcile.
    triggerSync(projectId) {
      for (const row of mappings.listForProject(db, projectId)) {
        sendTo(agentsByMachine.get(row.machine_id), { type: "sync", projectId });
      }
    },

    pushNotification(userId, notification) {
      sendTo(usersByUser.get(userId), { type: "notification", notification });
    },

    isMachineOnline(machineId) {
      const s = agentsByMachine.get(machineId);
      return !!s && s.size > 0;
    },

    close() {
      if (this._wss) {
        for (const c of this._wss.clients) c.terminate();
        this._wss.close();
      }
    },
  };
}
