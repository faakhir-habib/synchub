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
import { RealtimeGateway } from "../src/realtime/realtime.gateway.js";

let app: INestApplication;
let prisma: PrismaService;
let gateway: RealtimeGateway;
let port: number;

function rand(): string {
  return randomBytes(8).toString("hex");
}

const createdUserIds: number[] = [];
const openSockets: WebSocket[] = [];

async function signup(): Promise<{ token: string; userId: number }> {
  const email = `realtime-fanout-${rand()}@example.com`;
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

async function createProject(userId: number, syncMode: string) {
  return prisma.project.create({
    data: { user_id: userId, alias: `proj-${rand()}`, sync_mode: syncMode },
  });
}

async function mapMachine(projectId: number, machineId: number, localPath: string) {
  return prisma.mapping.create({
    data: { project_id: projectId, machine_id: machineId, local_path: localPath },
  });
}

// See realtime.e2e.test.ts for why the message queue is attached at socket
// construction time rather than after awaiting `open`: the server can emit
// "welcome" (and here, presence) frames fast enough to race an `await`
// continuation that would otherwise attach the "message" listener too late.
type WsMessage = { type: string; [key: string]: unknown };

interface TrackedSocket {
  ws: WebSocket;
  nextMessage(timeoutMs?: number): Promise<WsMessage>;
  nextMessageOfType(type: string, timeoutMs?: number): Promise<WsMessage>;
  expectNoMessage(timeoutMs?: number): Promise<void>;
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

  async function expectNoMessage(timeoutMs = 400): Promise<void> {
    await expect(nextMessage(timeoutMs)).rejects.toThrow(/timed out/);
  }

  return { ws, nextMessage, nextMessageOfType, expectNoMessage };
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
  gateway = app.get(RealtimeGateway);
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

describe("RealtimeGateway fan-out", () => {
  it("fans out notifyProjectChanged/syncProgress/syncComplete/pushNotification/triggerSync to the right sockets", async () => {
    const { token, userId } = await signup();
    const project = await createProject(userId, "auto");
    const machineA = await createMachine(token);
    const machineB = await createMachine(token);
    await mapMachine(project.id, machineA.id, "/home/a/proj");
    await mapMachine(project.id, machineB.id, "/home/b/proj");

    const user = connect(`ws://127.0.0.1:${port}/ws/user?token=${token}`);
    await waitForOpen(user.ws);
    await user.nextMessageOfType("welcome");

    const agentA = connect(`ws://127.0.0.1:${port}/ws/agent?token=${machineA.machineToken}`);
    await waitForOpen(agentA.ws);
    await agentA.nextMessageOfType("welcome");
    await user.nextMessageOfType("presence"); // A online

    const agentB = connect(`ws://127.0.0.1:${port}/ws/agent?token=${machineB.machineToken}`);
    await waitForOpen(agentB.ws);
    await agentB.nextMessageOfType("welcome");
    await user.nextMessageOfType("presence"); // B online

    // --- auto mode: agent fan-out excludes the originating machine, browsers always hear it ---
    gateway.notifyProjectChanged(project.id, {
      filename: "s.jsonl",
      hash: "h1",
      excludeMachineId: machineA.id,
    });

    const changedForB = await agentB.nextMessageOfType("changed");
    expect(changedForB).toEqual({
      type: "changed",
      projectId: project.id,
      filename: "s.jsonl",
      hash: "h1",
    });

    const changedForUser1 = await user.nextMessageOfType("changed");
    expect(changedForUser1).toEqual({
      type: "changed",
      projectId: project.id,
      filename: "s.jsonl",
      hash: "h1",
    });

    // By the time B and the user have received their "changed" frames, the
    // fan-out loop (which iterates mappings before notifying the user) has
    // fully run — so if A were going to receive anything, it'd already be
    // sitting in its queue.
    await agentA.expectNoMessage();

    // --- manual mode: no agent fan-out at all, but the browser still hears it ---
    await prisma.project.update({ where: { id: project.id }, data: { sync_mode: "manual" } });

    gateway.notifyProjectChanged(project.id, {
      filename: "s2.jsonl",
      hash: "h2",
    });

    const changedForUser2 = await user.nextMessageOfType("changed");
    expect(changedForUser2).toEqual({
      type: "changed",
      projectId: project.id,
      filename: "s2.jsonl",
      hash: "h2",
    });

    await agentA.expectNoMessage();
    await agentB.expectNoMessage();

    // --- syncProgress / syncComplete / pushNotification -> owning user's browsers ---
    gateway.syncProgress(userId, {
      projectId: project.id,
      machineId: machineA.id,
      completed: 1,
      total: 1,
      phase: "push",
    });
    expect(await user.nextMessageOfType("sync-progress")).toEqual({
      type: "sync-progress",
      projectId: project.id,
      machineId: machineA.id,
      completed: 1,
      total: 1,
      phase: "push",
    });

    const at = new Date().toISOString();
    gateway.syncComplete(userId, { projectId: project.id, machineId: machineA.id, at });
    expect(await user.nextMessageOfType("sync-complete")).toEqual({
      type: "sync-complete",
      projectId: project.id,
      machineId: machineA.id,
      at,
    });

    gateway.pushNotification(userId, { type: "sync", title: "t", body: "b" });
    expect(await user.nextMessageOfType("notification")).toEqual({
      type: "notification",
      notification: { type: "sync", title: "t", body: "b" },
    });

    // --- triggerSync -> ALL mapped agents, regardless of sync_mode (project is "manual" here) ---
    gateway.triggerSync(project.id);
    expect(await agentA.nextMessageOfType("sync-trigger")).toEqual({
      type: "sync-trigger",
      projectId: project.id,
    });
    expect(await agentB.nextMessageOfType("sync-trigger")).toEqual({
      type: "sync-trigger",
      projectId: project.id,
    });

    agentA.ws.close();
    agentB.ws.close();
    user.ws.close();
  });

  it("fans out notifyDeleted to other auto-mode agents + the owning user's browser, excluding the origin machine", async () => {
    const { token, userId } = await signup();
    const project = await createProject(userId, "auto");
    const machineA = await createMachine(token);
    const machineB = await createMachine(token);
    await mapMachine(project.id, machineA.id, "/home/a/proj");
    await mapMachine(project.id, machineB.id, "/home/b/proj");

    const user = connect(`ws://127.0.0.1:${port}/ws/user?token=${token}`);
    await waitForOpen(user.ws);
    await user.nextMessageOfType("welcome");

    const agentA = connect(`ws://127.0.0.1:${port}/ws/agent?token=${machineA.machineToken}`);
    await waitForOpen(agentA.ws);
    await agentA.nextMessageOfType("welcome");
    await user.nextMessageOfType("presence"); // A online

    const agentB = connect(`ws://127.0.0.1:${port}/ws/agent?token=${machineB.machineToken}`);
    await waitForOpen(agentB.ws);
    await agentB.nextMessageOfType("welcome");
    await user.nextMessageOfType("presence"); // B online

    // Origin is machineA — excluded from the agent fan-out, but the user's
    // browser always hears it and machineB (auto mode) hears it too.
    gateway.notifyDeleted(userId, project.id, "session.jsonl", machineA.id);

    const deletedForB = await agentB.nextMessageOfType("deleted");
    expect(deletedForB).toEqual({
      type: "deleted",
      projectId: project.id,
      filename: "session.jsonl",
    });

    const deletedForUser = await user.nextMessageOfType("deleted");
    expect(deletedForUser).toEqual({
      type: "deleted",
      projectId: project.id,
      filename: "session.jsonl",
    });

    // By the time B and the user have received their "deleted" frames, the
    // fan-out loop has fully run — if A were going to receive anything, it'd
    // already be sitting in its queue.
    await agentA.expectNoMessage();

    // Manual mode: no agent fan-out, but the browser still hears it.
    await prisma.project.update({ where: { id: project.id }, data: { sync_mode: "manual" } });

    gateway.notifyDeleted(userId, project.id, "other.jsonl");

    const deletedForUser2 = await user.nextMessageOfType("deleted");
    expect(deletedForUser2).toEqual({
      type: "deleted",
      projectId: project.id,
      filename: "other.jsonl",
    });

    await agentA.expectNoMessage();
    await agentB.expectNoMessage();

    agentA.ws.close();
    agentB.ws.close();
    user.ws.close();
  });
});
