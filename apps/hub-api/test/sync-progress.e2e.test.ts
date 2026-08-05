import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { json } from "express";
import { createHash, randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { RelayStoreService } from "../src/sync/relay-store.service.js";
import { AllExceptionsFilter } from "../src/common/errors/all-exceptions.filter.js";

// Test-scoped temp dir, mirrors sync-push.e2e.test.ts: RELAY_STORE_DIR must be
// set before AppModule is compiled (RelayStoreService reads it in its
// constructor), so the app's relay store and this test's blob seeding stay
// pointed at the same location.
const TEST_DIR = join(tmpdir(), "synchub-sync-progress-e2e-test");
rmSync(TEST_DIR, { recursive: true, force: true });
process.env.RELAY_STORE_DIR = TEST_DIR;

let app: INestApplication;
let prisma: PrismaService;
let relayStore: RelayStoreService;
let port: number;

function rand(): string {
  return randomBytes(8).toString("hex");
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

const createdUserIds: number[] = [];
const openSockets: WebSocket[] = [];

async function signup(): Promise<{ token: string; userId: number }> {
  const email = `sync-progress-${rand()}@example.com`;
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

async function createProject(token: string): Promise<{ id: number; alias: string }> {
  const res = await request(app.getHttpServer())
    .post("/api/projects")
    .set("Authorization", `Bearer ${token}`)
    .send({ alias: `proj-${rand()}` });
  return { id: res.body.id, alias: res.body.alias };
}

async function mapMachine(
  token: string,
  projectId: number,
  machineId: number,
  localPath: string,
): Promise<void> {
  const res = await request(app.getHttpServer())
    .put(`/api/projects/${projectId}/mappings/${machineId}`)
    .set("Authorization", `Bearer ${token}`)
    .send({ local_path: localPath });
  expect(res.status).toBe(200);
}

// Full fixture: a user + machine mapped into a fresh project. Isolated per
// test so ordering across cases doesn't matter.
async function setup(): Promise<{
  token: string;
  userId: number;
  machine: { id: number; machineToken: string };
  project: { id: number; alias: string };
}> {
  const { token, userId } = await signup();
  const machine = await createMachine(token);
  const project = await createProject(token);
  await mapMachine(token, project.id, machine.id, "/home/user/project");
  return { token, userId, machine, project };
}

function push(
  machineToken: string,
  projectId: number,
  body: { filename: string; content: string; base_hash?: string | null },
) {
  return request(app.getHttpServer())
    .post(`/api/agent/push/${projectId}`)
    .set("X-Machine-Token", machineToken)
    .send(body);
}

// See realtime.e2e.test.ts for why the message queue is attached at socket
// construction time rather than after awaiting `open`: the server can emit
// frames fast enough to race an `await` continuation that would otherwise
// attach the "message" listener too late.
type WsMessage = { type: string; [key: string]: unknown };

interface TrackedSocket {
  ws: WebSocket;
  nextMessage(timeoutMs?: number): Promise<WsMessage>;
  nextMessageOfType(type: string, timeoutMs?: number): Promise<WsMessage>;
  expectNoMessageOfType(type: string, timeoutMs?: number): Promise<void>;
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

  // Drains any messages that arrive within timeoutMs, asserting none of them
  // is of the given type. Unlike nextMessage's plain timeout, this tolerates
  // OTHER message types (e.g. "changed") showing up first, which matters
  // here since a push also fires notifyProjectChanged.
  async function expectNoMessageOfType(type: string, timeoutMs = 400): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      let msg: WsMessage;
      try {
        msg = await nextMessage(remaining);
      } catch {
        return;
      }
      expect(msg.type).not.toBe(type);
    }
  }

  return { ws, nextMessage, nextMessageOfType, expectNoMessageOfType };
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
  relayStore = app.get(RelayStoreService);
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
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("push -> live sync-progress/sync-complete to the pushing user's browsers", () => {
  it("first push (accepted): emits sync-progress then sync-complete to the user socket", async () => {
    const { token, userId, machine, project } = await setup();
    const filename = "session.jsonl";
    const content = '{"seq":1,"timestamp":100}\n';

    const user = connect(`ws://127.0.0.1:${port}/ws/user?token=${token}`);
    await waitForOpen(user.ws);
    await user.nextMessageOfType("welcome");

    const before = Date.now();
    const res = await push(machine.machineToken, project.id, { filename, content });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");

    const progress = await user.nextMessageOfType("sync-progress");
    expect(progress).toEqual({
      type: "sync-progress",
      projectId: project.id,
      machineId: machine.id,
      filename,
      completed: 1,
      total: 1,
      phase: "push",
    });

    const complete = await user.nextMessageOfType("sync-complete");
    expect(complete).toEqual({
      type: "sync-complete",
      projectId: project.id,
      machineId: machine.id,
      at: expect.any(String),
    });
    expect(new Date(complete.at as string).getTime()).toBeGreaterThanOrEqual(before);

    void userId;
    user.ws.close();
  });

  it("forward append (accepted, not first sync): emits sync-progress then sync-complete", async () => {
    const { token, machine, project } = await setup();
    const filename = "session.jsonl";
    const initial = '{"seq":1,"timestamp":100}\n';

    const first = await push(machine.machineToken, project.id, { filename, content: initial });
    expect(first.status).toBe(200);

    const user = connect(`ws://127.0.0.1:${port}/ws/user?token=${token}`);
    await waitForOpen(user.ws);
    await user.nextMessageOfType("welcome");

    const appended = initial + '{"seq":2,"timestamp":200}\n';
    const second = await push(machine.machineToken, project.id, {
      filename,
      content: appended,
      base_hash: first.body.hash,
    });
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("accepted");

    const progress = await user.nextMessageOfType("sync-progress");
    expect(progress).toEqual({
      type: "sync-progress",
      projectId: project.id,
      machineId: machine.id,
      filename,
      completed: 1,
      total: 1,
      phase: "push",
    });

    const complete = await user.nextMessageOfType("sync-complete");
    expect(complete).toEqual({
      type: "sync-complete",
      projectId: project.id,
      machineId: machine.id,
      at: expect.any(String),
    });

    user.ws.close();
  });

  it("divergent push (last-write-wins, accepted): emits sync-progress then sync-complete", async () => {
    const { token, userId, machine, project } = await setup();
    const filename = "session.jsonl";

    const line1 = '{"seq":1,"timestamp":100}';
    const line2 = '{"seq":2,"timestamp":200}';
    const lineA3 = '{"seq":3,"timestamp":300,"from":"a"}';
    const lineB3 = '{"seq":3,"timestamp":250,"from":"b"}';

    const canonicalContent = `${line1}\n${line2}\n${lineA3}\n`;
    const canonicalHash = relayStore.writeBlob(userId, canonicalContent);
    await prisma.fileState.create({
      data: {
        project_id: project.id,
        filename,
        hash: canonicalHash,
        size: Buffer.byteLength(canonicalContent, "utf8"),
      },
    });

    const incomingContent = `${line1}\n${line2}\n${lineB3}\n`;
    const staleBaseHash = sha256(`${line1}\n${line2}\n`);

    const user = connect(`ws://127.0.0.1:${port}/ws/user?token=${token}`);
    await waitForOpen(user.ws);
    await user.nextMessageOfType("welcome");

    const res = await push(machine.machineToken, project.id, {
      filename,
      content: incomingContent,
      base_hash: staleBaseHash,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");

    const progress = await user.nextMessageOfType("sync-progress");
    expect(progress).toEqual({
      type: "sync-progress",
      projectId: project.id,
      machineId: machine.id,
      filename,
      completed: 1,
      total: 1,
      phase: "push",
    });

    const complete = await user.nextMessageOfType("sync-complete");
    expect(complete).toEqual({
      type: "sync-complete",
      projectId: project.id,
      machineId: machine.id,
      at: expect.any(String),
    });

    user.ws.close();
  });

  it("identical re-push (unchanged): does NOT emit sync-progress or sync-complete", async () => {
    const { token, machine, project } = await setup();
    const filename = "session.jsonl";
    const content = '{"seq":1,"timestamp":100}\n';

    const first = await push(machine.machineToken, project.id, { filename, content });
    expect(first.status).toBe(200);

    const user = connect(`ws://127.0.0.1:${port}/ws/user?token=${token}`);
    await waitForOpen(user.ws);
    await user.nextMessageOfType("welcome");

    const second = await push(machine.machineToken, project.id, {
      filename,
      content,
      base_hash: first.body.hash,
    });
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("unchanged");

    await user.expectNoMessageOfType("sync-progress");
    await user.expectNoMessageOfType("sync-complete");

    user.ws.close();
  });

  it("unmergeable/edited push (last-write-wins, accepted): still emits sync-progress then sync-complete", async () => {
    const { token, userId, machine, project } = await setup();
    const filename = "session.jsonl";

    const line1 = '{"seq":1,"timestamp":100}';
    const line2 = '{"seq":2,"timestamp":200}';
    const lineA3 = '{"seq":3,"timestamp":300,"from":"a"}';

    const canonicalContent = `${line1}\n${line2}\n${lineA3}\n`;
    const canonicalHash = relayStore.writeBlob(userId, canonicalContent);
    await prisma.fileState.create({
      data: {
        project_id: project.id,
        filename,
        hash: canonicalHash,
        size: Buffer.byteLength(canonicalContent, "utf8"),
      },
    });

    // Non-JSON tail — under last-write-wins this is just another accepted push
    // (no conflict), so it emits the same progress/complete frames.
    const incomingContent = `${line1}\n${line2}\nnot-valid-json\n`;

    const user = connect(`ws://127.0.0.1:${port}/ws/user?token=${token}`);
    await waitForOpen(user.ws);
    await user.nextMessageOfType("welcome");

    const res = await push(machine.machineToken, project.id, {
      filename,
      content: incomingContent,
      base_hash: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");

    const progress = await user.nextMessageOfType("sync-progress");
    expect(progress).toMatchObject({
      type: "sync-progress",
      projectId: project.id,
      machineId: machine.id,
      filename,
      phase: "push",
    });

    const complete = await user.nextMessageOfType("sync-complete");
    expect(complete).toMatchObject({
      type: "sync-complete",
      projectId: project.id,
      machineId: machine.id,
    });

    user.ws.close();
  });
});
