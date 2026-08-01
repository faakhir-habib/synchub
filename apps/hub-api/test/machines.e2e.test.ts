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
  const email = `machines-${rand()}@example.com`;
  const res = await request(app.getHttpServer())
    .post("/api/auth/signup")
    .send({ email, password: "password123" });
  createdUserIds.push(res.body.user.id);
  return { token: res.body.token, userId: res.body.user.id, email };
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

describe("POST /api/machines", () => {
  it("creates a machine and returns the token once", async () => {
    const { token } = await signup();

    const res = await request(app.getHttpServer())
      .post("/api/machines")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Laptop", os: "linux", os_version: "6.1", label: "home" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Laptop",
      os: "linux",
      os_version: "6.1",
      label: "home",
      status: "offline",
    });
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.id).toEqual(expect.any(Number));
    // last_ip should be present as a key (may be null under supertest's fake IP handling).
    expect(res.body).toHaveProperty("last_ip");
  });

  it("returns 400 when name is missing", async () => {
    const { token } = await signup();

    const res = await request(app.getHttpServer())
      .post("/api/machines")
      .set("Authorization", `Bearer ${token}`)
      .send({ os: "linux" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("code");
  });

  it("returns 400 when name is an empty string", async () => {
    const { token } = await signup();

    const res = await request(app.getHttpServer())
      .post("/api/machines")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("code");
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/machines")
      .send({ name: "No Auth" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/machines", () => {
  it("lists machines for the current user without leaking the token", async () => {
    const { token } = await signup();

    await request(app.getHttpServer())
      .post("/api/machines")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Desktop" });

    const res = await request(app.getHttpServer())
      .get("/api/machines")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0]).toMatchObject({ name: "Desktop" });
    expect(res.body[0]).not.toHaveProperty("token");
    expect(res.body[0]).not.toHaveProperty("user_id");
  });

  it("only returns the current user's machines", async () => {
    const a = await signup();
    const b = await signup();

    await request(app.getHttpServer())
      .post("/api/machines")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ name: "A's machine" });
    await request(app.getHttpServer())
      .post("/api/machines")
      .set("Authorization", `Bearer ${b.token}`)
      .send({ name: "B's machine" });

    const res = await request(app.getHttpServer())
      .get("/api/machines")
      .set("Authorization", `Bearer ${a.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe("A's machine");
  });
});

describe("DELETE /api/machines/:id", () => {
  it("deletes a machine owned by the current user", async () => {
    const { token } = await signup();

    const create = await request(app.getHttpServer())
      .post("/api/machines")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "To Delete" });
    const id = create.body.id;

    const del = await request(app.getHttpServer())
      .delete(`/api/machines/${id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });

    const list = await request(app.getHttpServer())
      .get("/api/machines")
      .set("Authorization", `Bearer ${token}`);
    expect(list.body.find((m: { id: number }) => m.id === id)).toBeUndefined();
  });

  it("returns 404 for a nonexistent machine", async () => {
    const { token } = await signup();
    const res = await request(app.getHttpServer())
      .delete("/api/machines/999999999")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 (not 500) for a non-numeric id", async () => {
    const { token } = await signup();
    const res = await request(app.getHttpServer())
      .delete("/api/machines/abc")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 when deleting another user's machine", async () => {
    const a = await signup();
    const b = await signup();

    const create = await request(app.getHttpServer())
      .post("/api/machines")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ name: "A's machine" });
    const id = create.body.id;

    const del = await request(app.getHttpServer())
      .delete(`/api/machines/${id}`)
      .set("Authorization", `Bearer ${b.token}`);
    expect(del.status).toBe(404);
  });
});

describe("POST /api/machines/pair", () => {
  it("creates a 6-char pairing code", async () => {
    const { token } = await signup();

    const res = await request(app.getHttpServer())
      .post("/api/machines/pair")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(201);
    expect(res.body.expires_in).toBe(600);
    expect(res.body.code).toEqual(expect.any(String));
    expect(res.body.code).toHaveLength(6);
    expect(res.body.code).toMatch(/^[A-Z0-9]{6}$/);
  });
});

describe("POST /api/agent/pair/redeem", () => {
  it("redeems a valid code without authentication and creates a machine owned by the code's user", async () => {
    const { token, userId } = await signup();

    const pair = await request(app.getHttpServer())
      .post("/api/machines/pair")
      .set("Authorization", `Bearer ${token}`);
    const code = pair.body.code;

    // Deliberately no Authorization header.
    const redeem = await request(app.getHttpServer())
      .post("/api/agent/pair/redeem")
      .send({ code, name: "Paired Machine", os: "windows", agent_version: "1.2.3" });

    expect(redeem.status).toBe(201);
    expect(redeem.body.machineToken).toEqual(expect.any(String));
    expect(redeem.body.machineId).toEqual(expect.any(Number));

    const machine = await prisma.machine.findUnique({ where: { id: redeem.body.machineId } });
    expect(machine).not.toBeNull();
    expect(machine!.user_id).toBe(userId);
    expect(machine!.name).toBe("Paired Machine");
    expect(machine!.token).toBe(redeem.body.machineToken);
  });

  it("defaults the name to 'New machine' when not given", async () => {
    const { token } = await signup();
    const pair = await request(app.getHttpServer())
      .post("/api/machines/pair")
      .set("Authorization", `Bearer ${token}`);

    const redeem = await request(app.getHttpServer())
      .post("/api/agent/pair/redeem")
      .send({ code: pair.body.code });

    expect(redeem.status).toBe(201);
    const machine = await prisma.machine.findUnique({ where: { id: redeem.body.machineId } });
    expect(machine!.name).toBe("New machine");
  });

  it("returns 400 for an unknown code", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/agent/pair/redeem")
      .send({ code: "ZZZZZZ" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("code");
  });

  it("returns 400 when the same code is redeemed twice", async () => {
    const { token } = await signup();
    const pair = await request(app.getHttpServer())
      .post("/api/machines/pair")
      .set("Authorization", `Bearer ${token}`);
    const code = pair.body.code;

    const first = await request(app.getHttpServer())
      .post("/api/agent/pair/redeem")
      .send({ code });
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post("/api/agent/pair/redeem")
      .send({ code });
    expect(second.status).toBe(400);
  });

  it("returns 400 for an expired code", async () => {
    const { userId } = await signup();

    const expiredCode = `EXP${rand().slice(0, 3).toUpperCase()}`;
    await prisma.pairingCode.create({
      data: {
        code: expiredCode,
        user_id: userId,
        expires_at: new Date(Date.now() - 60_000),
      },
    });

    const res = await request(app.getHttpServer())
      .post("/api/agent/pair/redeem")
      .send({ code: expiredCode });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});
