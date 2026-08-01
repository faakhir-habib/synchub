import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { WebSocket, WebSocketServer } from "ws";
import { PrismaService } from "../prisma/prisma.service.js";
import type {
  PresencePayload,
  RealtimePort,
  SyncCompletePayload,
  SyncProgressPayload,
} from "./realtime.port.js";

interface AliveWebSocket extends WebSocket {
  isAlive?: boolean;
}

interface MachineIdentity {
  id: number;
  user_id: number;
}

interface UserIdentity {
  id: number;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

// Ports legacy hub/src/lib/realtime.js: a single noServer WebSocketServer
// attached to Nest's underlying HTTP server, routing upgrades by pathname
// (/ws/agent, /ws/user) with the token carried as a query param (since
// browsers/agents can't set custom headers on the WS handshake). Adds two
// things the legacy relay didn't have: (1) an explicit `presence` broadcast
// to the owning user's browsers on agent connect/disconnect (legacy only
// updated the DB row — see Phase 2 plan §7.1), and (2) a ping/pong heartbeat
// that terminates dead sockets through the same close path as a clean
// disconnect, so presence stays accurate even after a network drop.
@Injectable()
export class RealtimeGateway implements OnModuleInit, OnModuleDestroy, RealtimePort {
  private wss?: WebSocketServer;
  private hb?: ReturnType<typeof setInterval>;

  private readonly agentsByMachine = new Map<number, Set<AliveWebSocket>>();
  private readonly usersByUser = new Map<number, Set<AliveWebSocket>>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    const server = this.adapterHost.httpAdapter?.getHttpServer();
    if (!server) return;

    this.wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      void this.handleUpgrade(req, socket, head);
    });
    this.startHeartbeat();
  }

  onModuleDestroy(): void {
    if (this.hb) clearInterval(this.hb);
    this.wss?.clients.forEach((c) => c.terminate());
    this.wss?.close();
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    const token = url.searchParams.get("token");

    if (url.pathname === "/ws/agent") {
      const machine = token ? await this.prisma.machine.findUnique({ where: { token } }) : null;
      if (!machine) {
        socket.destroy();
        return;
      }
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        void this.onAgent(ws as AliveWebSocket, machine);
      });
      return;
    }

    if (url.pathname === "/ws/user") {
      const session = token
        ? await this.prisma.session.findUnique({ where: { token }, include: { user: true } })
        : null;
      if (!session || !session.expires_at || session.expires_at <= new Date()) {
        socket.destroy();
        return;
      }
      this.wss!.handleUpgrade(req, socket, head, (ws) => this.onUser(ws as AliveWebSocket, session.user));
      return;
    }

    socket.destroy();
  }

  private add<K>(map: Map<K, Set<AliveWebSocket>>, key: K, ws: AliveWebSocket): void {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(ws);
  }

  private remove<K>(map: Map<K, Set<AliveWebSocket>>, key: K, ws: AliveWebSocket): void {
    const set = map.get(key);
    if (!set) return;
    set.delete(ws);
    if (!set.size) map.delete(key);
  }

  private sendTo(set: Set<AliveWebSocket> | undefined, obj: unknown): void {
    if (!set) return;
    const msg = JSON.stringify(obj);
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  }

  private async setMachineStatus(machineId: number, status: "online" | "offline"): Promise<void> {
    try {
      await this.prisma.machine.update({
        where: { id: machineId },
        data: { status, last_seen_at: new Date() },
      });
    } catch {
      // Machine may have been deleted out from under an open socket — ignore.
    }
  }

  private async onAgent(ws: AliveWebSocket, machine: MachineIdentity): Promise<void> {
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    this.add(this.agentsByMachine, machine.id, ws);
    await this.setMachineStatus(machine.id, "online");
    this.broadcastPresence(machine.user_id, {
      machineId: machine.id,
      status: "online",
      lastSeenAt: new Date().toISOString(),
    });

    ws.send(JSON.stringify({ type: "welcome", machineId: machine.id }));

    ws.on("message", () => {
      /* agent inbound is ignored — presence is the connection itself, mirrors legacy */
    });

    ws.on("close", () => {
      void this.onAgentClose(ws, machine);
    });
  }

  private async onAgentClose(ws: AliveWebSocket, machine: MachineIdentity): Promise<void> {
    this.remove(this.agentsByMachine, machine.id, ws);
    if (this.agentsByMachine.get(machine.id)?.size) return;
    await this.setMachineStatus(machine.id, "offline");
    this.broadcastPresence(machine.user_id, {
      machineId: machine.id,
      status: "offline",
      lastSeenAt: new Date().toISOString(),
    });
  }

  private onUser(ws: AliveWebSocket, user: UserIdentity): void {
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    this.add(this.usersByUser, user.id, ws);
    ws.send(JSON.stringify({ type: "welcome", userId: user.id }));

    ws.on("close", () => {
      this.remove(this.usersByUser, user.id, ws);
    });
  }

  private startHeartbeat(): void {
    this.hb = setInterval(() => {
      const allSets = [...this.agentsByMachine.values(), ...this.usersByUser.values()];
      for (const set of allSets) {
        for (const ws of set) {
          if (ws.isAlive === false) {
            ws.terminate();
            continue;
          }
          ws.isAlive = false;
          ws.ping();
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  // --- RealtimePort ---

  broadcastPresence(userId: number, p: PresencePayload): void {
    this.sendTo(this.usersByUser.get(userId), { type: "presence", ...p });
  }

  syncProgress(userId: number, p: SyncProgressPayload): void {
    this.sendTo(this.usersByUser.get(userId), { type: "sync-progress", ...p });
  }

  syncComplete(userId: number, p: SyncCompletePayload): void {
    this.sendTo(this.usersByUser.get(userId), { type: "sync-complete", ...p });
  }

  pushNotification(
    userId: number,
    notification: { type: string; title: string; body?: string | null },
  ): void {
    this.sendTo(this.usersByUser.get(userId), { type: "notification", notification });
  }

  notifyProjectChanged(
    projectId: number,
    p: { filename: string; hash: string; excludeMachineId?: number },
  ): void {
    void this.doNotifyProjectChanged(projectId, p);
  }

  private async doNotifyProjectChanged(
    projectId: number,
    p: { filename: string; hash: string; excludeMachineId?: number },
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return;

    // Auto-mode: tell every other mapped agent to pull the change (TODO Task2:
    // reconcile against the fuller fan-out design — see hub/src/lib/realtime.js
    // notifyProjectChanged for the legacy behavior this mirrors).
    if (project.sync_mode === "auto") {
      const mappings = await this.prisma.mapping.findMany({ where: { project_id: projectId } });
      for (const mapping of mappings) {
        if (mapping.machine_id === p.excludeMachineId) continue;
        this.sendTo(this.agentsByMachine.get(mapping.machine_id), {
          type: "changed",
          projectId,
          filename: p.filename,
          hash: p.hash,
        });
      }
    }

    // Owning user's browsers always hear about it, regardless of sync mode.
    this.sendTo(this.usersByUser.get(project.user_id), {
      type: "changed",
      projectId,
      filename: p.filename,
      hash: p.hash,
    });
  }
}
