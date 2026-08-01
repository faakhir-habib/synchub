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
  const email = `sync-now-${rand()}@example.com`;
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

async function createProject(token: string, sync_mode = "manual"): Promise<{ id: number }> {
  const res = await request(app.getHttpServer())
    .post("/api/projects")
    .set("Authorization", `Bearer ${token}`)
    .send({ alias: `proj-${rand()}`, sync_mode });
  return { id: res.body.id };
}

async function mapMachine(token: string, projectId: number, machineId: number): Promise<void> {
  await request(app.getHttpServer())
    .put(`/api/projects/${projectId}/mappings/${machineId}`)
    .set("Authorization", `Bearer ${token}`)
    .send({ local_path: "/home/user/proj" });
}

// Mirrors realtime-fanout.e2e.test.ts's socket harness: the queue is attached
// at construction time (not after an `await open`) since the server can emit
// "welcome" fast enough to race a listener attached later.
interface TrackedSocket {
  ws: WebSocket;
  nextMessageOfType(type: string, timeoutMs?: number): Promise<any>;
}

function connect(url: string): TrackedSocket {
  const ws = new WebSocket(url);
  openSockets.push(ws);

  const queue: any[] = [];
  const waiters: Array<(msg: any) => void> = [];

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else queue.push(msg);
  });

  function nextMessage(timeoutMs = 3000): Promise<any> {
    if (queue.length) return Promise.resolve(queue.shift());
    return new Promise((resolve, reject) => {
      const onMsg = (msg: any) => {
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

  async function nextMessageOfType(type: string, timeoutMs = 3000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out waiting for message type "${type}"`);
      const msg = await nextMessage(remaining);
      if (msg.type === type) return msg;
    }
  }

  return { ws, nextMessageOfType };
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

describe("POST /api/projects/:id/sync-now", () => {
  it("triggers a connected mapped agent, records a sync_now event, and returns {status:'triggered'}", async () => {
    const { token, userId } = await signup();
    const project = await createProject(token, "manual");
    const machine = await createMachine(token);
    await mapMachine(token, project.id, machine.id);

    const agent = connect(`ws://127.0.0.1:${port}/ws/agent?token=${machine.machineToken}`);
    await waitForOpen(agent.ws);
    await agent.nextMessageOfType("welcome");

    const res = await request(app.getHttpServer())
      .post(`/api/projects/${project.id}/sync-now`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "triggered" });

    const trigger = await agent.nextMessageOfType("sync-trigger");
    expect(trigger).toEqual({ type: "sync-trigger", projectId: project.id });

    const event = await prisma.event.findFirst({
      where: { user_id: userId, project_id: project.id, type: "sync_now" },
    });
    expect(event).not.toBeNull();

    agent.ws.close();
  });

  it("returns 404 for a project not owned by the current user", async () => {
    const a = await signup();
    const b = await signup();
    const project = await createProject(a.token, "manual");

    const res = await request(app.getHttpServer())
      .post(`/api/projects/${project.id}/sync-now`)
      .set("Authorization", `Bearer ${b.token}`);

    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer()).post("/api/projects/1/sync-now");
    expect(res.status).toBe(401);
  });
});
