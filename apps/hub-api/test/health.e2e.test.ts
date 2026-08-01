import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { HealthResponse } from "@synchub/shared";

let app: INestApplication;

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe("GET /health", () => {
  it("returns a valid HealthResponse", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);
    const parsed = HealthResponse.parse(res.body);
    expect(parsed.status).toBe("ok");
  });
});
