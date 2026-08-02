import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { json } from "express";
import { randomBytes } from "node:crypto";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { AllExceptionsFilter } from "../src/common/errors/all-exceptions.filter.js";

let app: INestApplication;
let prisma: PrismaService;

function rand(): string {
  return randomBytes(8).toString("hex");
}

const createdUserIds: number[] = [];

async function signup(): Promise<{ token: string; userId: number }> {
  const email = `notifications-${rand()}@example.com`;
  const res = await request(app.getHttpServer())
    .post("/api/auth/signup")
    .send({ email, password: "password123" });
  createdUserIds.push(res.body.user.id);
  return { token: res.body.token, userId: res.body.user.id };
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.use(json({ limit: "25mb" }));
  app.setGlobalPrefix("api", { exclude: ["health", "api/health"] });
  app.set("trust proxy", 1);
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  prisma = app.get(PrismaService);
});

afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await app.close();
});

describe("GET /api/notifications", () => {
  it("returns unread count + items, newest first, with read mapped to boolean", async () => {
    const { token, userId } = await signup();

    await prisma.notification.create({
      data: { user_id: userId, type: "info", title: "Old", read: 1 },
    });
    await prisma.notification.create({
      data: { user_id: userId, type: "sync", title: "New unread" },
    });

    const res = await request(app.getHttpServer())
      .get("/api/notifications")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.unread).toBe(1);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].title).toBe("New unread");
    expect(res.body.items[0].read).toBe(false);
    expect(res.body.items[1].title).toBe("Old");
    expect(res.body.items[1].read).toBe(true);
  });

  it("caps items at 50", async () => {
    const { token, userId } = await signup();
    for (let i = 0; i < 55; i++) {
      await prisma.notification.create({
        data: { user_id: userId, type: "info", title: `n${i}` },
      });
    }

    const res = await request(app.getHttpServer())
      .get("/api/notifications")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(50);
    expect(res.body.unread).toBe(55);
  });

  it("only returns the current user's notifications", async () => {
    const a = await signup();
    const b = await signup();
    await prisma.notification.create({ data: { user_id: a.userId, type: "info", title: "A" } });
    await prisma.notification.create({ data: { user_id: b.userId, type: "info", title: "B" } });

    const res = await request(app.getHttpServer())
      .get("/api/notifications")
      .set("Authorization", `Bearer ${a.token}`);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe("A");
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer()).get("/api/notifications");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/notifications/:id/read", () => {
  it("marks a notification as read", async () => {
    const { token, userId } = await signup();
    const note = await prisma.notification.create({
      data: { user_id: userId, type: "info", title: "Mark me" },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/notifications/${note.id}/read`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const updated = await prisma.notification.findUnique({ where: { id: note.id } });
    expect(updated!.read).toBe(1);
  });

  it("returns 404 for another user's notification", async () => {
    const a = await signup();
    const b = await signup();
    const note = await prisma.notification.create({
      data: { user_id: a.userId, type: "info", title: "A's note" },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/notifications/${note.id}/read`)
      .set("Authorization", `Bearer ${b.token}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");

    const unchanged = await prisma.notification.findUnique({ where: { id: note.id } });
    expect(unchanged!.read).toBe(0);
  });

  it("returns 404 for a nonexistent id", async () => {
    const { token } = await signup();
    const res = await request(app.getHttpServer())
      .post("/api/notifications/999999999/read")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("returns 400 (not 500) for a non-numeric id", async () => {
    const { token } = await signup();
    const res = await request(app.getHttpServer())
      .post("/api/notifications/abc/read")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer()).post("/api/notifications/1/read");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/notifications/read-all", () => {
  it("marks all of the current user's notifications read without touching another user's", async () => {
    const a = await signup();
    const b = await signup();
    await prisma.notification.create({ data: { user_id: a.userId, type: "info", title: "1" } });
    await prisma.notification.create({ data: { user_id: a.userId, type: "info", title: "2" } });
    const bNote = await prisma.notification.create({
      data: { user_id: b.userId, type: "info", title: "B's" },
    });

    const res = await request(app.getHttpServer())
      .post("/api/notifications/read-all")
      .set("Authorization", `Bearer ${a.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const aUnread = await prisma.notification.count({ where: { user_id: a.userId, read: 0 } });
    expect(aUnread).toBe(0);

    const bStillUnread = await prisma.notification.findUnique({ where: { id: bNote.id } });
    expect(bStillUnread!.read).toBe(0);
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer()).post("/api/notifications/read-all");
    expect(res.status).toBe(401);
  });
});
