import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { json } from "express";
import { randomBytes } from "node:crypto";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { AllExceptionsFilter } from "../src/common/errors/all-exceptions.filter.js";

// Full-app smoke test: boots the real AppModule (every Phase-2a module
// wired together) exactly like main.ts does, and hits one endpoint per
// module. This exists to catch DI wiring mistakes (missing providers,
// circular imports, etc.) that per-module e2e tests can't see because
// they only ever import AppModule too -- but this is the one test whose
// entire purpose is "does the whole graph boot and talk to itself."

let app: INestApplication;
let prisma: PrismaService;

function rand(): string {
  return randomBytes(8).toString("hex");
}

const createdUserIds: number[] = [];

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.use(json({ limit: "25mb" }));
  app.setGlobalPrefix("api", { exclude: ["health", "api/health"] });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  prisma = app.get(PrismaService);
});

afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  // app.close() stops ScheduleModule's cron timers (among everything else
  // Nest tears down), so vitest can exit cleanly instead of hanging on the
  // daily session-sweep job's open handle.
  await app.close();
});

describe("AppModule smoke test (every Phase-2a module wired)", () => {
  it("GET /health (unprefixed infra probe) returns 200", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.status).toBe(200);
  });

  it("GET /api/health returns legacy-parity shape", async () => {
    const res = await request(app.getHttpServer()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("exercises every wired module end-to-end with one signed-up user", async () => {
    const email = `smoke-${rand()}@example.com`;
    const signup = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email, password: "password123" });
    expect(signup.status).toBe(201);
    const token = signup.body.token as string;
    createdUserIds.push(signup.body.user.id);

    // Auth/Users module.
    const me = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);

    // Machines module.
    const machines = await request(app.getHttpServer())
      .get("/api/machines")
      .set("Authorization", `Bearer ${token}`);
    expect(machines.status).toBe(200);
    expect(Array.isArray(machines.body)).toBe(true);

    // Projects module.
    const projects = await request(app.getHttpServer())
      .get("/api/projects")
      .set("Authorization", `Bearer ${token}`);
    expect(projects.status).toBe(200);
    expect(Array.isArray(projects.body)).toBe(true);

    // Notifications module.
    const notifications = await request(app.getHttpServer())
      .get("/api/notifications")
      .set("Authorization", `Bearer ${token}`);
    expect(notifications.status).toBe(200);
    expect(notifications.body).toHaveProperty("unread");
    expect(notifications.body).toHaveProperty("items");
    expect(Array.isArray(notifications.body.items)).toBe(true);

    // Dashboard module.
    const metrics = await request(app.getHttpServer())
      .get("/api/dashboard/metrics")
      .set("Authorization", `Bearer ${token}`);
    expect(metrics.status).toBe(200);
    expect(metrics.body).toMatchObject({
      projects: expect.any(Object),
      machines: expect.any(Object),
      eventsToday: expect.any(Number),
      dataTransferredBytes: expect.any(Number),
      sessionsSyncedToday: expect.any(Number),
      syncSuccessRate: expect.any(Number),
      unreadNotifications: expect.any(Number),
    });
    expect(metrics.body).toHaveProperty("avgLatencyMs");

    const activity = await request(app.getHttpServer())
      .get("/api/dashboard/activity")
      .set("Authorization", `Bearer ${token}`);
    expect(activity.status).toBe(200);
    expect(Array.isArray(activity.body)).toBe(true);
  });

  it("rejects an unauthenticated call to a protected route with { error, code }", async () => {
    const res = await request(app.getHttpServer()).get("/api/machines");
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("code");
  });
});
