import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { Controller, Get, UseGuards } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { SessionAuthGuard } from "../src/common/auth/session-auth.guard.js";
import { MachineAuthGuard } from "../src/common/auth/machine-auth.guard.js";
import { CurrentUser, CurrentMachine } from "../src/common/auth/current-user.decorator.js";

// Throwaway controllers used only to exercise the guards + param decorators
// without depending on any real feature route.
@Controller("throwaway-auth")
class ThrowawayAuthController {
  @UseGuards(SessionAuthGuard)
  @Get("session")
  session(@CurrentUser() user: { id: number }) {
    return { id: user.id };
  }

  @UseGuards(MachineAuthGuard)
  @Get("machine")
  machine(@CurrentMachine() machine: { id: number }) {
    return { id: machine.id };
  }
}

let app: INestApplication;
let prisma: PrismaService;

function rand(): string {
  return randomBytes(16).toString("hex");
}

let userId: number;
let validToken: string;
let expiredToken: string;
let nullExpiryToken: string;
let machineId: number;
let machineToken: string;

beforeAll(async () => {
  const mod = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ThrowawayAuthController],
  }).compile();
  app = mod.createNestApplication();
  await app.init();

  prisma = app.get(PrismaService);

  const user = await prisma.user.create({
    data: {
      email: `guard-test-${rand()}@example.com`,
      password_hash: "x",
      password_salt: "y",
    },
  });
  userId = user.id;

  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const past = new Date(Date.now() - 60 * 1000);

  validToken = `sess_${rand()}`;
  await prisma.session.create({
    data: { token: validToken, user_id: userId, expires_at: future },
  });

  expiredToken = `sess_${rand()}`;
  await prisma.session.create({
    data: { token: expiredToken, user_id: userId, expires_at: past },
  });

  nullExpiryToken = `sess_${rand()}`;
  await prisma.session.create({
    data: { token: nullExpiryToken, user_id: userId, expires_at: null },
  });

  const machine = await prisma.machine.create({
    data: {
      user_id: userId,
      name: "guard-test-machine",
      token: `mach_${rand()}`,
    },
  });
  machineId = machine.id;
  machineToken = machine.token;
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { user_id: userId } });
  await prisma.machine.deleteMany({ where: { user_id: userId } });
  await prisma.user.delete({ where: { id: userId } });
  await app.close();
});

describe("SessionAuthGuard", () => {
  it("401s with no Authorization header", async () => {
    const res = await request(app.getHttpServer()).get("/throwaway-auth/session");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("401s with a bad bearer token", async () => {
    const res = await request(app.getHttpServer())
      .get("/throwaway-auth/session")
      .set("Authorization", "Bearer nope-not-a-real-token");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("200s and echoes the user id for a valid, unexpired session", async () => {
    const res = await request(app.getHttpServer())
      .get("/throwaway-auth/session")
      .set("Authorization", `Bearer ${validToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: userId });
  });

  it("401s for a session with expires_at in the past", async () => {
    const res = await request(app.getHttpServer())
      .get("/throwaway-auth/session")
      .set("Authorization", `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("401s for a session with expires_at = null", async () => {
    const res = await request(app.getHttpServer())
      .get("/throwaway-auth/session")
      .set("Authorization", `Bearer ${nullExpiryToken}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });
});

describe("MachineAuthGuard", () => {
  it("401s with a bad X-Machine-Token", async () => {
    const res = await request(app.getHttpServer())
      .get("/throwaway-auth/machine")
      .set("X-Machine-Token", "nope-not-a-real-token");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("401s with no X-Machine-Token header", async () => {
    const res = await request(app.getHttpServer()).get("/throwaway-auth/machine");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("200s and echoes the machine id for a valid token", async () => {
    const res = await request(app.getHttpServer())
      .get("/throwaway-auth/machine")
      .set("X-Machine-Token", machineToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: machineId });
  });
});
