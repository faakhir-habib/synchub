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

// Test-scoped temp dir, mirrors sync-push.e2e.test.ts: RELAY_STORE_DIR must be
// set before AppModule is compiled (RelayStoreService reads it in its
// constructor).
const TEST_DIR = join(tmpdir(), "synchub-sync-delete-e2e-test");
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
  const email = `sync-delete-${rand()}@example.com`;
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

function del(machineToken: string, projectId: number, filename: string) {
  return request(app.getHttpServer())
    .post(`/api/agent/delete/${projectId}`)
    .set("X-Machine-Token", machineToken)
    .send({ filename });
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

describe("POST /api/agent/delete/:projectId", () => {
  it("deletes an existing file_state row, records a delete event, returns {status:'deleted'}", async () => {
    const { userId, machine, project } = await setup();
    const filename = "session.jsonl";
    const content = '{"seq":1,"timestamp":100}\n';
    const hash = relayStore.writeBlob(userId, content);
    await prisma.fileState.create({
      data: {
        project_id: project.id,
        filename,
        hash,
        size: Buffer.byteLength(content, "utf8"),
      },
    });

    const res = await del(machine.machineToken, project.id, filename);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "deleted" });

    const fileState = await prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: project.id, filename } },
    });
    expect(fileState).toBeNull();

    const event = await prisma.event.findFirst({
      where: { project_id: project.id, filename, type: "delete" },
    });
    expect(event).not.toBeNull();
  });

  it("deleting a non-existent filename is a no-op: 200 {status:'deleted'}, no crash, no event", async () => {
    const { machine, project } = await setup();
    const filename = "never-existed.jsonl";

    const res = await del(machine.machineToken, project.id, filename);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "deleted" });

    const event = await prisma.event.findFirst({
      where: { project_id: project.id, filename, type: "delete" },
    });
    expect(event).toBeNull();
  });

  it("returns 404 for a project the machine is not mapped to", async () => {
    const { token } = await signup();
    const machine = await createMachine(token);
    const project = await createProject(token);
    // No mapping created.

    const res = await del(machine.machineToken, project.id, "session.jsonl");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "not mapped to project");
  });

  it("returns 400 for an unsafe filename (path traversal)", async () => {
    const { machine, project } = await setup();

    const res = await del(machine.machineToken, project.id, "../../etc/passwd");

    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/agent/delete/1")
      .send({ filename: "session.jsonl" });

    expect(res.status).toBe(401);
  });
});
