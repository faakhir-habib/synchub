import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { json } from "express";
import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { AllExceptionsFilter } from "../src/common/errors/all-exceptions.filter.js";

let app: INestApplication;
let prisma: PrismaService;
let port: number;

function rand(): string {
  return randomBytes(8).toString("hex");
}

const createdUserIds: number[] = [];
const openSockets: WebSocket[] = [];

async function signup(): Promise<{ token: string; userId: number }> {
  const email = `realtime-${rand()}@example.com`;
  const res = await request(app.getHttpServer())
    .post("/api/auth/signup")
    .send({ email, password: "password123" });
  createdUserIds.push(res.body.user.id);
  return { token: res.body.token, userId: res.body.user.id };
}

async function createMachine(token: string): Promise<{ id: number; machineToken: string }> {
  const res = await request(app.getHttpServer())
    .post("/api/machines")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: `Machine-${rand()}` });
  return { id: res.body.id, machineToken: res.body.token };
}

// A WebSocket client wrapper whose "message" listener is attached at socket
// construction time (not after awaiting `open`). This matters: the server
// sends its "welcome" frame immediately after the handshake completes, and
// if the handshake response + welcome frame land in the same TCP segment,
// the `ws` client can emit "open" and "message" back-to-back in the same
// synchronous callback — before an `await waitForOpen(ws)` continuation gets
// a chance to run and attach a listener. Queuing messages from the moment
// the socket is created sidesteps that race entirely.
type WsMessage = { type: string; [key: string]: unknown };

interface TrackedSocket {
  ws: WebSocket;
  nextMessage(timeoutMs?: number): Promise<WsMessage>;
  nextMessageOfType(type: string, timeoutMs?: number): Promise<WsMessage>;
}

function connect(url: string): TrackedSocket {
  const ws = new WebSocket(url);
  openSockets.push(ws);

  const queue: WsMessage[] = [];
  const waiters: Array<(msg: WsMessage) => void> = [];

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as WsMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else queue.push(msg);
  });

  function nextMessage(timeoutMs = 3000): Promise<WsMessage> {
    if (queue.length) return Promise.resolve(queue.shift() as WsMessage);
    return new Promise((resolve, reject) => {
      const onMsg = (msg: WsMessage) => {
        clearTimeout(timer);
        resolve(msg);
      };
      const timer = setTimeout(() => {
        const idx = waiters.indexOf(onMsg);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error(`timed out waiting for a message after ${timeoutMs}ms`));
      }, timeoutMs);
      waiters.push(onMsg);
    });
  }

  async function nextMessageOfType(type: string, timeoutMs = 3000): Promise<WsMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out waiting for message type "${type}"`);
      const msg = await nextMessage(remaining);
      if (msg.type === type) return msg;
    }
  }

  return { ws, nextMessage, nextMessageOfType };
}

function waitForOpen(ws: WebSocket, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for open")), timeoutMs);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForCloseOrError(ws: WebSocket, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for close/error")),
      timeoutMs,
    );
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    ws.once("close", done);
    ws.once("error", done);
  });
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.use(json({ limit: "25mb" }));
  app.setGlobalPrefix("api", { exclude: ["health", "api/health"] });
  app.set("trust proxy", 1);
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.listen(0);

  const address = app.getHttpServer().address() as AddressInfo;
  port = address.port;

  prisma = app.get(PrismaService);
});

afterAll(async () => {
  for (const ws of openSockets) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.terminate();
    }
  }
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await app.close();
});

describe("RealtimeGateway", () => {
  it("welcomes a /ws/user connection with a valid session token", async () => {
    const { token, userId } = await signup();

    const user = connect(`ws://127.0.0.1:${port}/ws/user?token=${token}`);
    await waitForOpen(user.ws);
    const welcome = await user.nextMessage();

    expect(welcome).toEqual({ type: "welcome", userId });

    user.ws.close();
  });

  it("welcomes a /ws/agent connection, marks the machine online, and broadcasts presence to the user", async () => {
    const { token, userId } = await signup();
    const machine = await createMachine(token);

    const user = connect(`ws://127.0.0.1:${port}/ws/user?token=${token}`);
    await waitForOpen(user.ws);
    await user.nextMessageOfType("welcome");
    // The machine already existed when the user socket connected, so the
    // connect-time presence snapshot (see sendPresenceSnapshot) queues one
    // "offline" frame for it ahead of the "online" one the agent triggers
    // below — drain it first so the assertions below see the live update.
    await user.nextMessageOfType("presence");

    const agent = connect(`ws://127.0.0.1:${port}/ws/agent?token=${machine.machineToken}`);
    await waitForOpen(agent.ws);
    const agentWelcome = await agent.nextMessage();
    expect(agentWelcome).toEqual({ type: "welcome", machineId: machine.id });

    const presence = await user.nextMessageOfType("presence");
    expect(presence).toMatchObject({
      type: "presence",
      machineId: machine.id,
      status: "online",
    });
    expect(presence.lastSeenAt).toEqual(expect.any(String));

    const row = await prisma.machine.findUnique({ where: { id: machine.id } });
    expect(row?.status).toBe("online");

    agent.ws.close();
    user.ws.close();
  });

  it("marks the machine offline and broadcasts presence when the agent socket closes", async () => {
    const { token } = await signup();
    const machine = await createMachine(token);

    const user = connect(`ws://127.0.0.1:${port}/ws/user?token=${token}`);
    await waitForOpen(user.ws);
    await user.nextMessageOfType("welcome");
    // Same connect-time snapshot as above: the machine already exists
    // (offline) when the user socket connects, so drain that frame first.
    await user.nextMessageOfType("presence"); // initial offline snapshot

    const agent = connect(`ws://127.0.0.1:${port}/ws/agent?token=${machine.machineToken}`);
    await waitForOpen(agent.ws);
    await agent.nextMessage(); // agent welcome
    await user.nextMessageOfType("presence"); // online presence

    agent.ws.close();

    const offlinePresence = await user.nextMessageOfType("presence");
    expect(offlinePresence).toMatchObject({
      type: "presence",
      machineId: machine.id,
      status: "offline",
    });

    const row = await prisma.machine.findUnique({ where: { id: machine.id } });
    expect(row?.status).toBe("offline");

    user.ws.close();
  });

  it("sends a presence snapshot for every owned machine when a /ws/user socket connects", async () => {
    const { token } = await signup();
    const onlineMachine = await createMachine(token);
    const offlineMachine = await createMachine(token);

    // Seed DB status directly rather than connecting a real agent — this is
    // a snapshot-on-connect test, not another exercise of the agent-connect
    // broadcast path (already covered above).
    await prisma.machine.update({
      where: { id: onlineMachine.id },
      data: { status: "online", last_seen_at: new Date() },
    });

    const user = connect(`ws://127.0.0.1:${port}/ws/user?token=${token}`);
    await waitForOpen(user.ws);
    await user.nextMessageOfType("welcome");

    const first = await user.nextMessageOfType("presence");
    const second = await user.nextMessageOfType("presence");
    const byMachineId = new Map([first, second].map((m) => [m.machineId, m]));

    expect(byMachineId.get(onlineMachine.id)).toMatchObject({
      type: "presence",
      status: "online",
    });
    expect(byMachineId.get(offlineMachine.id)).toMatchObject({
      type: "presence",
      status: "offline",
    });

    user.ws.close();
  });

  it("rejects a /ws/agent connection with an invalid token", async () => {
    const bad = connect(`ws://127.0.0.1:${port}/ws/agent?token=badtoken`);

    let openFired = false;
    bad.ws.once("open", () => {
      openFired = true;
    });

    await waitForCloseOrError(bad.ws);
    expect(openFired).toBe(false);
  });

  it("rejects a /ws/user connection with an expired session token", async () => {
    const { userId } = await signup();

    // A real user, a real session row — just expired. Proves the WS upgrade
    // path checks expiry (mirroring SessionAuthGuard), not merely "does a
    // session with this token exist."
    const expiredToken = `expired-${rand()}`;
    await prisma.session.create({
      data: {
        token: expiredToken,
        user_id: userId,
        expires_at: new Date(Date.now() - 60_000),
      },
    });

    const bad = connect(`ws://127.0.0.1:${port}/ws/user?token=${expiredToken}`);

    let openFired = false;
    bad.ws.once("open", () => {
      openFired = true;
    });

    await waitForCloseOrError(bad.ws);
    expect(openFired).toBe(false);
  });

  it("rejects a connection on an unknown WS path", async () => {
    const { token } = await signup();

    const bad = connect(`ws://127.0.0.1:${port}/ws/nope?token=${token}`);

    let openFired = false;
    bad.ws.once("open", () => {
      openFired = true;
    });

    await waitForCloseOrError(bad.ws);
    expect(openFired).toBe(false);
  });
});
