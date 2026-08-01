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
import { NotifyService } from "../src/notify/notify.service.js";
import { AllExceptionsFilter } from "../src/common/errors/all-exceptions.filter.js";

let app: INestApplication;
let prisma: PrismaService;
let notify: NotifyService;
let port: number;

function rand(): string {
  return randomBytes(8).toString("hex");
}

const createdUserIds: number[] = [];
const openSockets: WebSocket[] = [];

async function signup(): Promise<{ token: string; userId: number }> {
  const email = `notify-realtime-${rand()}@example.com`;
  const res = await request(app.getHttpServer())
    .post("/api/auth/signup")
    .send({ email, password: "password123" });
  createdUserIds.push(res.body.user.id);
  return { token: res.body.token, userId: res.body.user.id };
}

// See test/realtime.e2e.test.ts for why the message queue is attached at
// socket construction time rather than after awaiting `open`.
interface TrackedSocket {
  ws: WebSocket;
  nextMessage(timeoutMs?: number): Promise<any>;
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
  notify = app.get(NotifyService);
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

describe("NotifyService -> RealtimeGateway live WS push", () => {
  it("delivers a `notification` frame to the user's connected browser socket when notify() fires", async () => {
    const { token, userId } = await signup();

    const user = connect(`ws://127.0.0.1:${port}/ws/user?token=${token}`);
    await waitForOpen(user.ws);
    await user.nextMessageOfType("welcome");

    const note = await notify.notify({
      user_id: userId,
      type: "sync",
      title: "Sync complete",
      body: "3 files updated",
    });
    expect(note).not.toBeNull();

    const frame = await user.nextMessageOfType("notification");
    expect(frame).toEqual({
      type: "notification",
      notification: { type: "sync", title: "Sync complete", body: "3 files updated" },
    });

    user.ws.close();
  });

  it("does not deliver a frame when the notify is gated out by the user's preferences", async () => {
    const { token, userId } = await signup();
    await prisma.user.update({ where: { id: userId }, data: { notify_conflicts: 0 } });

    const user = connect(`ws://127.0.0.1:${port}/ws/user?token=${token}`);
    await waitForOpen(user.ws);
    await user.nextMessageOfType("welcome");

    const note = await notify.notify({ user_id: userId, type: "conflict", title: "Conflict!" });
    expect(note).toBeNull();

    await expect(user.nextMessage(400)).rejects.toThrow(/timed out/);

    user.ws.close();
  });
});
