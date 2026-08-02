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
  const email = `conflicts-${rand()}@example.com`;
  const res = await request(app.getHttpServer())
    .post("/api/auth/signup")
    .send({ email, password: "password123" });
  createdUserIds.push(res.body.user.id);
  return { token: res.body.token, userId: res.body.user.id };
}

async function createProject(token: string, alias: string): Promise<{ id: number }> {
  const res = await request(app.getHttpServer())
    .post("/api/projects")
    .set("Authorization", `Bearer ${token}`)
    .send({ alias });
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

describe("GET /api/conflicts", () => {
  it("returns only the current user's OPEN conflicts across all their projects, newest first, with project_alias and boolean auto_merged", async () => {
    const me = await signup();
    const other = await signup();

    const projectA = await createProject(me.token, `alpha-${rand()}`);
    const projectB = await createProject(me.token, `beta-${rand()}`);
    const otherProject = await createProject(other.token, `other-${rand()}`);

    // Older open conflict in project A.
    const older = await prisma.conflict.create({
      data: {
        project_id: projectA.id,
        filename: "old.txt",
        candidate_hash: "hash-old",
        status: "open",
      },
    });
    await prisma.conflict.update({
      where: { id: older.id },
      data: { created_at: new Date(Date.now() - 60_000) },
    });

    // Newer open conflict in project B, auto-merged.
    const newer = await prisma.conflict.create({
      data: {
        project_id: projectB.id,
        filename: "new.txt",
        candidate_hash: "hash-new",
        status: "open",
        auto_merged: 1,
      },
    });

    // Resolved conflict for this user — must be excluded.
    await prisma.conflict.create({
      data: {
        project_id: projectA.id,
        filename: "resolved.txt",
        candidate_hash: "hash-resolved",
        status: "resolved",
        resolved_at: new Date(),
      },
    });

    // Open conflict belonging to a different user's project — must be excluded.
    await prisma.conflict.create({
      data: {
        project_id: otherProject.id,
        filename: "not-mine.txt",
        candidate_hash: "hash-other",
        status: "open",
      },
    });

    const res = await request(app.getHttpServer())
      .get("/api/conflicts")
      .set("Authorization", `Bearer ${me.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    expect(res.body[0].id).toBe(newer.id);
    expect(res.body[0].filename).toBe("new.txt");
    expect(res.body[0].project_alias).toBe(projectB.alias);
    expect(res.body[0].auto_merged).toBe(true);
    expect(res.body[0].status).toBe("open");

    expect(res.body[1].id).toBe(older.id);
    expect(res.body[1].filename).toBe("old.txt");
    expect(res.body[1].project_alias).toBe(projectA.alias);
    expect(res.body[1].auto_merged).toBe(false);

    const filenames = res.body.map((c: { filename: string }) => c.filename);
    expect(filenames).not.toContain("resolved.txt");
    expect(filenames).not.toContain("not-mine.txt");
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer()).get("/api/conflicts");
    expect(res.status).toBe(401);
  });
});
