import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { Controller, Get, Post, HttpException, HttpStatus, Body } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { json } from "express";
import { AppModule } from "../src/app.module.js";
import { AllExceptionsFilter } from "../src/common/errors/all-exceptions.filter.js";

// Throwaway controller used only to exercise the exception filter and body-limit
// behavior without depending on any real feature route.
@Controller("throwaway")
class ThrowawayController {
  @Get("boom")
  boom(): never {
    throw new HttpException("boom happened", HttpStatus.BAD_REQUEST);
  }

  @Post("echo")
  echo(@Body() body: unknown) {
    return { received: true, size: JSON.stringify(body).length };
  }
}

let app: INestApplication;

beforeAll(async () => {
  const mod = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ThrowawayController],
  }).compile();
  app = mod.createNestApplication();
  app.use(json({ limit: "25mb" }));
  app.setGlobalPrefix("api", { exclude: ["health", "api/health"] });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe("bootstrap hardening", () => {
  it("GET /api/health returns legacy-parity shape", async () => {
    const res = await request(app.getHttpServer()).get("/api/health").expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("GET /health (unprefixed) still serves the infra probe", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);
    expect(res.body).toHaveProperty("status");
  });

  it("returns { error, code } shape via the exception filter", async () => {
    const res = await request(app.getHttpServer()).get("/api/throwaway/boom");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("code");
  });

  it("returns { error, code } shape for a guaranteed 404", async () => {
    const res = await request(app.getHttpServer()).get("/api/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("code");
  });

  it("accepts a ~200KB JSON body (proves the 25mb limit, not the express default)", async () => {
    const bigString = "x".repeat(200 * 1024);
    const res = await request(app.getHttpServer())
      .post("/api/throwaway/echo")
      .send({ data: bigString });
    expect(res.status).not.toBe(413);
    expect(res.status).toBe(201);
  });
});
