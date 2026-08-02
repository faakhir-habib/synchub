import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { json } from "express";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { RelayStoreService } from "../src/sync/relay-store.service.js";
import { AllExceptionsFilter } from "../src/common/errors/all-exceptions.filter.js";

// Test-scoped temp dir (fixed name, not Math.random/Date.now-derived) so
// RELAY_STORE_DIR can be pointed at an isolated location for this suite.
// RelayStoreService reads process.env.RELAY_STORE_DIR in its constructor, so
// this must be set before AppModule is compiled below (which instantiates
// the RelayStoreService provider registered by SyncModule) — this keeps the
// app's relay store and this test's blob seeding pointed at the same dir.
const TEST_DIR = join(tmpdir(), "synchub-sync-read-e2e-test");
rmSync(TEST_DIR, { recursive: true, force: true });
process.env.RELAY_STORE_DIR = TEST_DIR;

let app: INestApplication;
let prisma: PrismaService;
let relayStore: RelayStoreService;

function rand(): string {
  return randomBytes(8).toString("hex");
}

const createdUserIds: number[] = [];

async function signup(): Promise<{ token: string; userId: number }> {
  const email = `sync-read-${rand()}@example.com`;
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

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.use(json({ limit: "25mb" }));
  app.setGlobalPrefix("api", { exclude: ["health", "api/health"] });
  app.set("trust proxy", 1);
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  prisma = app.get(PrismaService);
  relayStore = app.get(RelayStoreService);
});

afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await app.close();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("GET /api/agent/mappings", () => {
  it("returns the machine's mappings with alias + sync_mode, and marks the machine online", async () => {
    const { token } = await signup();
    const machine = await createMachine(token);
    const project = await createProject(token);
    await mapMachine(token, project.id, machine.id, "/home/user/project");

    const before = await prisma.machine.findUnique({ where: { id: machine.id } });
    expect(before!.status).toBe("offline");

    const res = await request(app.getHttpServer())
      .get("/api/agent/mappings")
      .set("X-Machine-Token", machine.machineToken);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        project_id: project.id,
        machine_id: machine.id,
        local_path: "/home/user/project",
        alias: project.alias,
        sync_mode: "auto",
      },
    ]);

    const after = await prisma.machine.findUnique({ where: { id: machine.id } });
    expect(after!.status).toBe("online");
    expect(after!.last_seen_at).not.toBeNull();
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer()).get("/api/agent/mappings");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/agent/manifest/:projectId", () => {
  it("returns the file_state rows for a mapped project", async () => {
    const { token, userId } = await signup();
    const machine = await createMachine(token);
    const project = await createProject(token);
    await mapMachine(token, project.id, machine.id, "/home/user/project");

    const content = '{"line":1}\n';
    const hash = relayStore.writeBlob(userId, content);
    await prisma.fileState.create({
      data: {
        project_id: project.id,
        filename: "abc123.jsonl",
        hash,
        size: Buffer.byteLength(content, "utf8"),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/agent/manifest/${project.id}`)
      .set("X-Machine-Token", machine.machineToken);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      filename: "abc123.jsonl",
      hash,
      size: Buffer.byteLength(content, "utf8"),
    });
    expect(typeof res.body[0].updated_at).toBe("string");
  });

  it("returns 404 for a project the machine is not mapped to", async () => {
    const { token } = await signup();
    const machine = await createMachine(token);
    const project = await createProject(token);
    // No mapping created.

    const res = await request(app.getHttpServer())
      .get(`/api/agent/manifest/${project.id}`)
      .set("X-Machine-Token", machine.machineToken);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "not mapped to project");
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer()).get("/api/agent/manifest/1");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/agent/pull/:projectId/:filename", () => {
  it("returns the seeded content with an x-ndjson content type", async () => {
    const { token, userId } = await signup();
    const machine = await createMachine(token);
    const project = await createProject(token);
    await mapMachine(token, project.id, machine.id, "/home/user/project");

    const content = '{"line":1}\n{"line":2}\n';
    const hash = relayStore.writeBlob(userId, content);
    await prisma.fileState.create({
      data: {
        project_id: project.id,
        filename: "session.jsonl",
        hash,
        size: Buffer.byteLength(content, "utf8"),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/agent/pull/${project.id}/session.jsonl`)
      .set("X-Machine-Token", machine.machineToken);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/x-ndjson/);
    expect(res.text).toBe(content);
  });

  it("returns 404 for an unknown filename", async () => {
    const { token } = await signup();
    const machine = await createMachine(token);
    const project = await createProject(token);
    await mapMachine(token, project.id, machine.id, "/home/user/project");

    const res = await request(app.getHttpServer())
      .get(`/api/agent/pull/${project.id}/does-not-exist.jsonl`)
      .set("X-Machine-Token", machine.machineToken);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "not found");
  });

  it("returns 400 for an unsafe filename (path traversal attempt)", async () => {
    const { token } = await signup();
    const machine = await createMachine(token);
    const project = await createProject(token);
    await mapMachine(token, project.id, machine.id, "/home/user/project");

    const res = await request(app.getHttpServer())
      .get(`/api/agent/pull/${project.id}/${encodeURIComponent("../x")}`)
      .set("X-Machine-Token", machine.machineToken);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid filename");
  });

  it("returns 404 for a project the machine is not mapped to", async () => {
    const { token } = await signup();
    const machine = await createMachine(token);
    const project = await createProject(token);
    // No mapping created.

    const res = await request(app.getHttpServer())
      .get(`/api/agent/pull/${project.id}/session.jsonl`)
      .set("X-Machine-Token", machine.machineToken);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "not mapped to project");
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer()).get("/api/agent/pull/1/session.jsonl");
    expect(res.status).toBe(401);
  });
});
