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
  await app.close();
});

describe("POST /api/auth/signup", () => {
  it("signs up a new user and returns a working session token", async () => {
    const email = `signup-${rand()}@example.com`;
    const res = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email, password: "password123", name: "Signup User" });

    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email, name: "Signup User" });
    expect(res.body.user.id).toEqual(expect.any(Number));
    createdUserIds.push(res.body.user.id);

    // Session actually works.
    const me = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);

    // Session row was created with a future expiry.
    const session = await prisma.session.findUnique({ where: { token: res.body.token } });
    expect(session).not.toBeNull();
    expect(session!.expires_at).not.toBeNull();
    expect(session!.expires_at!.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns 409 for a duplicate email", async () => {
    const email = `dupe-${rand()}@example.com`;
    const first = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email, password: "password123" });
    expect(first.status).toBe(201);
    createdUserIds.push(first.body.user.id);

    const second = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email, password: "password123" });
    expect(second.status).toBe(409);
    expect(second.body).toHaveProperty("error");
    expect(second.body).toHaveProperty("code");
  });

  it("returns 400 for a password shorter than 8 characters", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email: `short-${rand()}@example.com`, password: "short1" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("code");
  });

  it("returns 400 for a missing email", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ password: "password123" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("code");
  });

  it("returns 400 for an invalid email", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email: "not-an-email", password: "password123" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("code");
  });

  it("is case-insensitive: signup with uppercase email, login with lowercase works", async () => {
    const local = `case-${rand()}`;
    const mixedEmail = `${local}@Example.COM`;
    const lowerEmail = mixedEmail.toLowerCase();

    const signup = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email: mixedEmail, password: "password123" });
    expect(signup.status).toBe(201);
    expect(signup.body.user.email).toBe(lowerEmail);
    createdUserIds.push(signup.body.user.id);

    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: lowerEmail, password: "password123" });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe(lowerEmail);
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials", async () => {
    const email = `login-${rand()}@example.com`;
    const signup = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email, password: "password123" });
    createdUserIds.push(signup.body.user.id);

    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email, password: "password123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email });
  });

  it("returns 401 for bad credentials", async () => {
    const email = `badcreds-${rand()}@example.com`;
    const signup = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email, password: "password123" });
    createdUserIds.push(signup.body.user.id);

    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("code");
  });

  it("returns 401 for an unknown email", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: `unknown-${rand()}@example.com`, password: "password123" });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("code");
  });
});

describe("GET /api/auth/me", () => {
  it("returns the MeResponse shape with real booleans", async () => {
    const email = `me-${rand()}@example.com`;
    const signup = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email, password: "password123" });
    createdUserIds.push(signup.body.user.id);
    const token = signup.body.token;

    const res = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: signup.body.user.id,
      email,
      name: null,
      notify_webhook_url: null,
    });
    expect(typeof res.body.notify_sync).toBe("boolean");
    expect(res.body.notify_sync).toBe(true);
  });
});

describe("PUT /api/auth/me", () => {
  it("updates the name (truncated to 120 chars) and toggles a notify boolean, persisted", async () => {
    const email = `update-${rand()}@example.com`;
    const signup = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email, password: "password123" });
    createdUserIds.push(signup.body.user.id);
    const token = signup.body.token;

    const longName = "n".repeat(150);
    const res = await request(app.getHttpServer())
      .put("/api/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: longName, notify_sync: false });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("n".repeat(120));
    expect(res.body.notify_sync).toBe(false);

    // Persisted: re-fetch via /me.
    const me = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(me.body.name).toBe("n".repeat(120));
    expect(me.body.notify_sync).toBe(false);
  });

  it("persists notify_webhook_url set and clear via PUT /me", async () => {
    const email = `update-webhook-${rand()}@example.com`;
    const signup = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email, password: "password123" });
    createdUserIds.push(signup.body.user.id);
    const token = signup.body.token;

    const set = await request(app.getHttpServer())
      .put("/api/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ notify_webhook_url: "https://example.com/hook" });
    expect(set.status).toBe(200);
    expect(set.body.notify_webhook_url).toBe("https://example.com/hook");

    const meAfterSet = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(meAfterSet.body.notify_webhook_url).toBe("https://example.com/hook");

    const clear = await request(app.getHttpServer())
      .put("/api/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ notify_webhook_url: null });
    expect(clear.status).toBe(200);
    expect(clear.body.notify_webhook_url).toBeNull();

    const meAfterClear = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(meAfterClear.body.notify_webhook_url).toBeNull();
  });

  it("persists a notify_sync toggle", async () => {
    const email = `update-sync-${rand()}@example.com`;
    const signup = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email, password: "password123" });
    createdUserIds.push(signup.body.user.id);
    const token = signup.body.token;

    const res = await request(app.getHttpServer())
      .put("/api/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ notify_sync: false });
    expect(res.status).toBe(200);
    expect(res.body.notify_sync).toBe(false);

    const me = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(me.body.notify_sync).toBe(false);
  });

  it("leaves a previously-set notify_webhook_url unchanged when a later PUT only sets name", async () => {
    const email = `update-partial-${rand()}@example.com`;
    const signup = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email, password: "password123" });
    createdUserIds.push(signup.body.user.id);
    const token = signup.body.token;

    const first = await request(app.getHttpServer())
      .put("/api/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ notify_webhook_url: "https://example.com/keep-me" });
    expect(first.status).toBe(200);
    expect(first.body.notify_webhook_url).toBe("https://example.com/keep-me");

    const second = await request(app.getHttpServer())
      .put("/api/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Just A Name Update" });
    expect(second.status).toBe(200);
    expect(second.body.name).toBe("Just A Name Update");
    // Explicitly-set webhook from the earlier PUT must survive this partial update.
    expect(second.body.notify_webhook_url).toBe("https://example.com/keep-me");

    const me = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(me.body.notify_webhook_url).toBe("https://example.com/keep-me");
  });
});

describe("PUT /api/auth/me/notify-webhook", () => {
  it("sets and then clears the webhook url", async () => {
    const email = `webhook-${rand()}@example.com`;
    const signup = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email, password: "password123" });
    createdUserIds.push(signup.body.user.id);
    const token = signup.body.token;

    const set = await request(app.getHttpServer())
      .put("/api/auth/me/notify-webhook")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: "https://example.com/hook" });
    expect(set.status).toBe(200);
    expect(set.body.notify_webhook_url).toBe("https://example.com/hook");

    const clear = await request(app.getHttpServer())
      .put("/api/auth/me/notify-webhook")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: null });
    expect(clear.status).toBe(200);
    expect(clear.body.notify_webhook_url).toBeNull();
  });
});

describe("POST /api/auth/logout", () => {
  it("deletes the session so /me subsequently 401s", async () => {
    const email = `logout-${rand()}@example.com`;
    const signup = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email, password: "password123" });
    createdUserIds.push(signup.body.user.id);
    const token = signup.body.token;

    const logout = await request(app.getHttpServer())
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(logout.status).toBe(200);
    expect(logout.body).toEqual({ ok: true });

    const me = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(401);
  });
});
