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

async function signup(): Promise<{ token: string; userId: number; email: string }> {
  const email = `projects-${rand()}@example.com`;
  const res = await request(app.getHttpServer())
    .post("/api/auth/signup")
    .send({ email, password: "password123" });
  createdUserIds.push(res.body.user.id);
  return { token: res.body.token, userId: res.body.user.id, email };
}

async function createMachine(token: string, name = "Machine"): Promise<number> {
  const res = await request(app.getHttpServer())
    .post("/api/machines")
    .set("Authorization", `Bearer ${token}`)
    .send({ name });
  return res.body.id;
}

async function createProject(token: string, alias: string, sync_mode?: string): Promise<any> {
  const res = await request(app.getHttpServer())
    .post("/api/projects")
    .set("Authorization", `Bearer ${token}`)
    .send({ alias, ...(sync_mode ? { sync_mode } : {}) });
  return res.body;
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

describe("POST /api/projects", () => {
  it("creates a project with default sync_mode auto", async () => {
    const { token } = await signup();

    const res = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ alias: "My Project" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ alias: "My Project", sync_mode: "auto" });
    expect(res.body.id).toEqual(expect.any(Number));
    expect(res.body.created_at).toEqual(expect.any(String));
  });

  it("creates a project with an explicit sync_mode", async () => {
    const { token } = await signup();

    const res = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ alias: "Manual Project", sync_mode: "manual" });

    expect(res.status).toBe(201);
    expect(res.body.sync_mode).toBe("manual");
  });

  it("returns 400 for a missing alias", async () => {
    const { token } = await signup();

    const res = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("code");
  });

  it("returns 400 for an invalid sync_mode", async () => {
    const { token } = await signup();

    const res = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ alias: "Bad Mode", sync_mode: "bogus" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 409 for a duplicate alias for the same user", async () => {
    const { token } = await signup();
    await createProject(token, "Dup Alias");

    const res = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ alias: "Dup Alias" });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty("error");
  });

  it("allows two different users to use the same alias", async () => {
    const a = await signup();
    const b = await signup();
    await createProject(a.token, "Shared Alias");

    const res = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Authorization", `Bearer ${b.token}`)
      .send({ alias: "Shared Alias" });

    expect(res.status).toBe(201);
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer()).post("/api/projects").send({ alias: "No Auth" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/projects", () => {
  it("lists projects for the current user only, ordered by created_at", async () => {
    const a = await signup();
    const b = await signup();
    await createProject(a.token, "A1");
    await createProject(a.token, "A2");
    await createProject(b.token, "B1");

    const res = await request(app.getHttpServer())
      .get("/api/projects")
      .set("Authorization", `Bearer ${a.token}`);

    expect(res.status).toBe(200);
    expect(res.body.map((p: any) => p.alias)).toEqual(["A1", "A2"]);
  });
});

describe("GET /api/projects/:id", () => {
  it("returns project detail with mappings, tracked_files, last_sync_at, activity", async () => {
    const { token, userId } = await signup();
    const project = await createProject(token, "Detail Project");
    const machineId = await createMachine(token, "Laptop");

    await request(app.getHttpServer())
      .put(`/api/projects/${project.id}/mappings/${machineId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ local_path: "/home/user/proj" });

    // Seed file_state rows to verify tracked_files count + last_sync_at.
    await prisma.fileState.create({
      data: { project_id: project.id, filename: "a.txt", hash: "hash1", size: 10 },
    });
    await prisma.fileState.create({
      data: { project_id: project.id, filename: "b.txt", hash: "hash2", size: 20 },
    });

    // Seed an event to verify activity.
    await prisma.event.create({
      data: { user_id: userId, project_id: project.id, type: "sync", filename: "a.txt", bytes: 10 },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/projects/${project.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.alias).toBe("Detail Project");
    expect(res.body.tracked_files).toBe(2);
    expect(res.body.last_sync_at).toEqual(expect.any(String));
    expect(res.body.mappings).toEqual([
      { machine_id: machineId, local_path: "/home/user/proj", alias: "Laptop" },
    ]);
    expect(res.body.activity.length).toBe(1);
    expect(res.body.activity[0]).toMatchObject({ type: "sync", filename: "a.txt" });
  });

  it("returns null last_sync_at and 0 tracked_files when no file_state rows exist", async () => {
    const { token } = await signup();
    const project = await createProject(token, "Empty Project");

    const res = await request(app.getHttpServer())
      .get(`/api/projects/${project.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.tracked_files).toBe(0);
    expect(res.body.last_sync_at).toBeNull();
    expect(res.body.mappings).toEqual([]);
    expect(res.body.activity).toEqual([]);
  });

  it("returns 404 for a project not owned by the current user", async () => {
    const a = await signup();
    const b = await signup();
    const project = await createProject(a.token, "Owned By A");

    const res = await request(app.getHttpServer())
      .get(`/api/projects/${project.id}`)
      .set("Authorization", `Bearer ${b.token}`);

    expect(res.status).toBe(404);
  });

  it("returns 400 (not 500) for a non-numeric id", async () => {
    const { token } = await signup();
    const res = await request(app.getHttpServer())
      .get("/api/projects/abc")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/projects/:id", () => {
  it("renames a project", async () => {
    const { token } = await signup();
    const project = await createProject(token, "Old Name");

    const res = await request(app.getHttpServer())
      .put(`/api/projects/${project.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ alias: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.alias).toBe("New Name");
  });

  it("returns 400 for an empty alias", async () => {
    const { token } = await signup();
    const project = await createProject(token, "Keep Name");

    const res = await request(app.getHttpServer())
      .put(`/api/projects/${project.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ alias: "   " });

    expect(res.status).toBe(400);
  });

  it("returns 409 for a duplicate alias", async () => {
    const { token } = await signup();
    await createProject(token, "Taken");
    const project = await createProject(token, "Renamable");

    const res = await request(app.getHttpServer())
      .put(`/api/projects/${project.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ alias: "Taken" });

    expect(res.status).toBe(409);
  });

  it("returns 404 for a project not owned by the current user", async () => {
    const a = await signup();
    const b = await signup();
    const project = await createProject(a.token, "A's Project");

    const res = await request(app.getHttpServer())
      .put(`/api/projects/${project.id}`)
      .set("Authorization", `Bearer ${b.token}`)
      .send({ alias: "Hijacked" });

    expect(res.status).toBe(404);
  });

  it("also updates sync_mode when provided", async () => {
    const { token } = await signup();
    const project = await createProject(token, "Mode Change");

    const res = await request(app.getHttpServer())
      .put(`/api/projects/${project.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ sync_mode: "stopped" });

    expect(res.status).toBe(200);
    expect(res.body.sync_mode).toBe("stopped");
    expect(res.body.alias).toBe("Mode Change");
  });
});

describe("PUT /api/projects/:id/sync-mode", () => {
  it("updates the sync mode", async () => {
    const { token } = await signup();
    const project = await createProject(token, "Sync Mode Project");

    const res = await request(app.getHttpServer())
      .put(`/api/projects/${project.id}/sync-mode`)
      .set("Authorization", `Bearer ${token}`)
      .send({ sync_mode: "manual" });

    expect(res.status).toBe(200);
    expect(res.body.sync_mode).toBe("manual");
  });

  it("returns 400 for an invalid sync_mode", async () => {
    const { token } = await signup();
    const project = await createProject(token, "Sync Mode Invalid");

    const res = await request(app.getHttpServer())
      .put(`/api/projects/${project.id}/sync-mode`)
      .set("Authorization", `Bearer ${token}`)
      .send({ sync_mode: "bogus" });

    expect(res.status).toBe(400);
  });

  it("returns 404 for a project not owned by the current user", async () => {
    const a = await signup();
    const b = await signup();
    const project = await createProject(a.token, "A's Sync Mode Project");

    const res = await request(app.getHttpServer())
      .put(`/api/projects/${project.id}/sync-mode`)
      .set("Authorization", `Bearer ${b.token}`)
      .send({ sync_mode: "manual" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/projects/:id", () => {
  it("deletes a project owned by the current user", async () => {
    const { token } = await signup();
    const project = await createProject(token, "To Delete");

    const res = await request(app.getHttpServer())
      .delete(`/api/projects/${project.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const get = await request(app.getHttpServer())
      .get(`/api/projects/${project.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(404);
  });

  it("returns 404 for a project not owned by the current user", async () => {
    const a = await signup();
    const b = await signup();
    const project = await createProject(a.token, "A's Deletable Project");

    const res = await request(app.getHttpServer())
      .delete(`/api/projects/${project.id}`)
      .set("Authorization", `Bearer ${b.token}`);

    expect(res.status).toBe(404);
  });
});

describe("PUT /api/projects/:id/mappings/:machineId", () => {
  it("creates a mapping", async () => {
    const { token } = await signup();
    const project = await createProject(token, "Mapping Project");
    const machineId = await createMachine(token, "Desktop");

    const res = await request(app.getHttpServer())
      .put(`/api/projects/${project.id}/mappings/${machineId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ local_path: "/home/user/one" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      project_id: project.id,
      machine_id: machineId,
      local_path: "/home/user/one",
    });
  });

  it("updates the local_path on a second upsert", async () => {
    const { token } = await signup();
    const project = await createProject(token, "Mapping Update Project");
    const machineId = await createMachine(token, "Server");

    await request(app.getHttpServer())
      .put(`/api/projects/${project.id}/mappings/${machineId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ local_path: "/home/user/first" });

    const res = await request(app.getHttpServer())
      .put(`/api/projects/${project.id}/mappings/${machineId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ local_path: "/home/user/second" });

    expect(res.status).toBe(200);
    expect(res.body.local_path).toBe("/home/user/second");

    const mappings = await prisma.mapping.findMany({
      where: { project_id: project.id, machine_id: machineId },
    });
    expect(mappings.length).toBe(1);
  });

  it("returns 400 when local_path is missing", async () => {
    const { token } = await signup();
    const project = await createProject(token, "Mapping Missing Path");
    const machineId = await createMachine(token, "NoPath");

    const res = await request(app.getHttpServer())
      .put(`/api/projects/${project.id}/mappings/${machineId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 404 when the project is not owned by the current user", async () => {
    const a = await signup();
    const b = await signup();
    const project = await createProject(a.token, "A's Mapping Project");
    const machineId = await createMachine(b.token, "B's Machine");

    const res = await request(app.getHttpServer())
      .put(`/api/projects/${project.id}/mappings/${machineId}`)
      .set("Authorization", `Bearer ${b.token}`)
      .send({ local_path: "/x" });

    expect(res.status).toBe(404);
  });

  it("returns 404 when the machine is not owned by the current user", async () => {
    const a = await signup();
    const b = await signup();
    const project = await createProject(a.token, "A's Mapping Project 2");
    const machineId = await createMachine(b.token, "B's Machine 2");

    const res = await request(app.getHttpServer())
      .put(`/api/projects/${project.id}/mappings/${machineId}`)
      .set("Authorization", `Bearer ${a.token}`)
      .send({ local_path: "/x" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/projects/:id/mappings/:machineId", () => {
  it("deletes an existing mapping", async () => {
    const { token } = await signup();
    const project = await createProject(token, "Mapping Delete Project");
    const machineId = await createMachine(token, "ToUnmap");

    await request(app.getHttpServer())
      .put(`/api/projects/${project.id}/mappings/${machineId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ local_path: "/x" });

    const res = await request(app.getHttpServer())
      .delete(`/api/projects/${project.id}/mappings/${machineId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns 404 for a mapping that does not exist", async () => {
    const { token } = await signup();
    const project = await createProject(token, "No Mapping Project");
    const machineId = await createMachine(token, "Unmapped");

    const res = await request(app.getHttpServer())
      .delete(`/api/projects/${project.id}/mappings/${machineId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("returns 404 when the project is not owned by the current user", async () => {
    const a = await signup();
    const b = await signup();
    const project = await createProject(a.token, "A's Project For Unmap");
    const machineId = await createMachine(a.token, "A's Machine");

    const res = await request(app.getHttpServer())
      .delete(`/api/projects/${project.id}/mappings/${machineId}`)
      .set("Authorization", `Bearer ${b.token}`);

    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:id/conflicts", () => {
  it("returns open conflicts for the project, newest first", async () => {
    const { token } = await signup();
    const project = await createProject(token, "Conflict Project");

    const older = await prisma.conflict.create({
      data: { project_id: project.id, filename: "old.txt", candidate_hash: "h1" },
    });
    await new Promise((r) => setTimeout(r, 5));
    const newer = await prisma.conflict.create({
      data: { project_id: project.id, filename: "new.txt", candidate_hash: "h2" },
    });
    // A resolved conflict should not show up.
    await prisma.conflict.create({
      data: {
        project_id: project.id,
        filename: "resolved.txt",
        candidate_hash: "h3",
        status: "resolved",
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/projects/${project.id}/conflicts`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].id).toBe(newer.id);
    expect(res.body[1].id).toBe(older.id);
    expect(res.body[0]).toHaveProperty("auto_merged");
    expect(typeof res.body[0].auto_merged).toBe("boolean");
  });

  it("returns 404 for a project not owned by the current user", async () => {
    const a = await signup();
    const b = await signup();
    const project = await createProject(a.token, "A's Conflict Project");

    const res = await request(app.getHttpServer())
      .get(`/api/projects/${project.id}/conflicts`)
      .set("Authorization", `Bearer ${b.token}`);

    expect(res.status).toBe(404);
  });
});
