import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { json } from "express";
import { randomBytes } from "node:crypto";
import { DashboardMetrics } from "@synchub/shared";
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
  const email = `dashboard-${rand()}@example.com`;
  const res = await request(app.getHttpServer())
    .post("/api/auth/signup")
    .send({ email, password: "password123" });
  createdUserIds.push(res.body.user.id);
  return { token: res.body.token, userId: res.body.user.id };
}

async function createProject(userId: number, alias: string, syncMode = "auto") {
  return prisma.project.create({
    data: { user_id: userId, alias, sync_mode: syncMode },
  });
}

async function createMachine(userId: number, name: string, status: "online" | "offline") {
  return prisma.machine.create({
    data: { user_id: userId, name, token: `mach_${rand()}`, status },
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

  prisma = app.get(PrismaService);
});

afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await app.close();
});

describe("GET /api/dashboard/metrics", () => {
  it("computes every tile from seeded data, matching the legacy stats.js formulas", async () => {
    const me = await signup();
    const other = await signup();

    // projects: 2 total, 1 syncing (sync_mode != 'stopped').
    const projectA = await createProject(me.userId, `alpha-${rand()}`, "auto");
    const projectB = await createProject(me.userId, `beta-${rand()}`, "stopped");

    // machines: 2 total, 1 online.
    await createMachine(me.userId, "laptop", "online");
    await createMachine(me.userId, "desktop", "offline");

    // 1 open conflict (joined through the user's project) + 1 resolved (excluded).
    await prisma.conflict.create({
      data: { project_id: projectA.id, filename: "conflicted.txt", candidate_hash: "h1", status: "open" },
    });
    await prisma.conflict.create({
      data: {
        project_id: projectA.id,
        filename: "resolved.txt",
        candidate_hash: "h2",
        status: "resolved",
        resolved_at: new Date(),
      },
    });

    // Events today: mix of push / auto_merge / conflict, with bytes + latency_ms + filenames.
    const todaysEvents = [
      { type: "push", filename: "a.txt", project: projectA, bytes: 100, latency_ms: 200 },
      { type: "push", filename: "b.txt", project: projectA, bytes: 200, latency_ms: 300 },
      // Same project/filename pair as the first push -> must not double-count in sessionsSyncedToday.
      { type: "auto_merge", filename: "a.txt", project: projectA, bytes: 50, latency_ms: null },
      { type: "auto_merge", filename: "c.txt", project: projectB, bytes: 150, latency_ms: 100 },
      { type: "conflict", filename: "d.txt", project: projectA, bytes: 0, latency_ms: null },
    ];
    for (const e of todaysEvents) {
      await prisma.event.create({
        data: {
          user_id: me.userId,
          project_id: e.project.id,
          type: e.type,
          filename: e.filename,
          bytes: e.bytes,
          latency_ms: e.latency_ms,
        },
      });
    }

    // Notifications: 2 unread, 1 read.
    await prisma.notification.create({ data: { user_id: me.userId, type: "info", title: "1", read: 0 } });
    await prisma.notification.create({ data: { user_id: me.userId, type: "info", title: "2", read: 0 } });
    await prisma.notification.create({ data: { user_id: me.userId, type: "info", title: "3", read: 1 } });

    // Other user's data — must never leak into `me`'s metrics.
    const otherProject = await createProject(other.userId, `other-${rand()}`, "auto");
    await createMachine(other.userId, "other-machine", "online");
    await prisma.conflict.create({
      data: { project_id: otherProject.id, filename: "not-mine.txt", candidate_hash: "h3", status: "open" },
    });
    await prisma.event.create({
      data: { user_id: other.userId, project_id: otherProject.id, type: "push", filename: "x.txt", bytes: 999, latency_ms: 1 },
    });
    await prisma.notification.create({ data: { user_id: other.userId, type: "info", title: "other", read: 0 } });

    const res = await request(app.getHttpServer())
      .get("/api/dashboard/metrics")
      .set("Authorization", `Bearer ${me.token}`);

    expect(res.status).toBe(200);
    const body = DashboardMetrics.parse(res.body);

    // Expected values computed from the exact rows seeded above, mirroring
    // hub/src/models/stats.js#dashboardMetrics field-by-field.
    const eventsToday = todaysEvents.length;
    const dataTransferredBytes = todaysEvents.reduce((sum, e) => sum + e.bytes, 0);
    const sessionsSyncedToday = new Set(
      todaysEvents
        .filter((e) => (e.type === "push" || e.type === "auto_merge") && e.filename)
        .map((e) => `${e.project.id}/${e.filename}`),
    ).size;
    const ok = todaysEvents.filter((e) => e.type === "push" || e.type === "auto_merge").length;
    const conflictCount = todaysEvents.filter((e) => e.type === "conflict").length;
    const denom = ok + conflictCount;
    const syncSuccessRate = denom > 0 ? Math.round((ok / denom) * 1000) / 10 : 100;
    const latencies = todaysEvents.filter((e) => e.latency_ms != null).map((e) => e.latency_ms as number);
    const avgLatencyMs =
      latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;

    expect(body.projects).toEqual({ total: 2, syncing: 1 });
    expect(body.machines).toEqual({ total: 2, online: 1 });
    expect(body.openConflicts).toBe(1);
    expect(body.eventsToday).toBe(eventsToday);
    expect(body.dataTransferredBytes).toBe(dataTransferredBytes);
    expect(body.sessionsSyncedToday).toBe(sessionsSyncedToday);
    expect(body.syncSuccessRate).toBe(syncSuccessRate);
    expect(body.avgLatencyMs).toBe(avgLatencyMs);
    expect(body.unreadNotifications).toBe(2);

    // Sanity: our seeded numbers actually exercise the interesting cases.
    expect(sessionsSyncedToday).toBe(3);
    expect(syncSuccessRate).toBe(80);
    expect(avgLatencyMs).toBe(200);
  });

  it("defaults syncSuccessRate to 100 (not 0) for a fresh user with no events", async () => {
    const fresh = await signup();

    const res = await request(app.getHttpServer())
      .get("/api/dashboard/metrics")
      .set("Authorization", `Bearer ${fresh.token}`);

    expect(res.status).toBe(200);
    const body = DashboardMetrics.parse(res.body);
    expect(body.syncSuccessRate).toBe(100);
    expect(body.avgLatencyMs).toBeNull();
    expect(body.projects).toEqual({ total: 0, syncing: 0 });
    expect(body.machines).toEqual({ total: 0, online: 0 });
    expect(body.openConflicts).toBe(0);
    expect(body.eventsToday).toBe(0);
    expect(body.dataTransferredBytes).toBe(0);
    expect(body.sessionsSyncedToday).toBe(0);
    expect(body.unreadNotifications).toBe(0);
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer()).get("/api/dashboard/metrics");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/dashboard/activity", () => {
  it("returns the user's events newest-first and respects limit clamping", async () => {
    const me = await signup();
    const other = await signup();

    const total = 105;
    const base = Date.now() - total * 1000;
    for (let i = 0; i < total; i++) {
      await prisma.event.create({
        data: {
          user_id: me.userId,
          type: "push",
          filename: `f${i}.txt`,
          bytes: i,
          created_at: new Date(base + i * 1000),
        },
      });
    }
    // Another user's events must never appear in `me`'s activity feed.
    await prisma.event.create({ data: { user_id: other.userId, type: "push", filename: "other.txt" } });

    // Default limit (20), newest-first.
    const defaultRes = await request(app.getHttpServer())
      .get("/api/dashboard/activity")
      .set("Authorization", `Bearer ${me.token}`);
    expect(defaultRes.status).toBe(200);
    expect(defaultRes.body).toHaveLength(20);
    expect(defaultRes.body[0].filename).toBe(`f${total - 1}.txt`);
    expect(defaultRes.body[19].filename).toBe(`f${total - 20}.txt`);
    expect(defaultRes.body.every((e: { user_id: number }) => e.user_id === me.userId)).toBe(true);

    // Explicit small limit.
    const smallRes = await request(app.getHttpServer())
      .get("/api/dashboard/activity?limit=5")
      .set("Authorization", `Bearer ${me.token}`);
    expect(smallRes.body).toHaveLength(5);
    expect(smallRes.body[0].filename).toBe(`f${total - 1}.txt`);
    expect(smallRes.body[4].filename).toBe(`f${total - 5}.txt`);

    // Limit above the seeded count but clamped to <= 100.
    const bigRes = await request(app.getHttpServer())
      .get("/api/dashboard/activity?limit=1000")
      .set("Authorization", `Bearer ${me.token}`);
    expect(bigRes.body).toHaveLength(100);
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer()).get("/api/dashboard/activity");
    expect(res.status).toBe(401);
  });
});
