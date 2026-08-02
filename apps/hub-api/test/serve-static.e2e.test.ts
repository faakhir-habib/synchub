import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { json } from "express";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AllExceptionsFilter } from "../src/common/errors/all-exceptions.filter.js";

// Regression test for app.module.ts's ServeStaticModule wiring: the SPA
// fallback must serve `/` and unknown client routes, WITHOUT ever shadowing
// `/api/*`, `/health`, or `/api/health`. If a future edit to the `exclude`
// array in app.module.ts drops one of those entries, this test catches it.
//
// app.module.ts computes `webDistDir` (and whether to register
// ServeStaticModule at all, via `existsSync(webDistDir)`) as MODULE-LEVEL
// code, evaluated once when the module is first loaded — not lazily inside a
// constructor. So `WEB_DIST_DIR` must be set, and the stub dist dir must
// already exist on disk, BEFORE app.module.ts is ever imported in this
// file's module registry. A static top-of-file `import { AppModule }` would
// be too late (ESM hoists imports, so its module-level code would already
// have run against whatever WEB_DIST_DIR happened to be at process start).
// A dynamic `import()` inside beforeAll, issued after the env var and the
// temp dir are both in place, is what makes the `existsSync` gate see them.
//
// This also deliberately boots via `NestFactory.create(AppModule)` (like
// main.ts) rather than `Test.createTestingModule(...).compile()` (like the
// other e2e suites in this dir): @nestjs/serve-static picks its Express vs.
// no-op loader from a factory provider that reads `HttpAdapterHost.httpAdapter`
// at DI-instantiation time. Under `Test.createTestingModule().compile()`,
// that instantiation happens before `createNestApplication()` ever attaches
// an adapter to the host, so the factory always sees it as unset and falls
// back to a loader that silently registers nothing — the static/catch-all
// routes never get added and every request 404s, with no error anywhere.
// `NestFactory.create()` attaches the adapter before providers are
// instantiated, so it picks the real Express loader, matching production.

const DIST_DIR = mkdtempSync(join(tmpdir(), "synchub-serve-static-e2e-"));
const STUB_HTML = "<html><body>SPA</body></html>";

let app: INestApplication;

beforeAll(async () => {
  writeFileSync(join(DIST_DIR, "index.html"), STUB_HTML);
  process.env.WEB_DIST_DIR = DIST_DIR;

  const { AppModule } = await import("../src/app.module.js");

  app = await NestFactory.create(AppModule, { logger: false });
  app.use(json({ limit: "25mb" }));
  app.setGlobalPrefix("api", { exclude: ["health", "api/health"] });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
});

afterAll(async () => {
  await app.close();
  delete process.env.WEB_DIST_DIR;
  rmSync(DIST_DIR, { recursive: true, force: true });
});

describe("ServeStaticModule serve/exclude (SPA fallback vs. /api)", () => {
  it("GET / serves the stub SPA index.html", async () => {
    const res = await request(app.getHttpServer()).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("SPA");
    expect(res.type).toBe("text/html");
  });

  it("GET /projects/123 (a client route) falls back to the SPA index.html", async () => {
    const res = await request(app.getHttpServer()).get("/projects/123");
    expect(res.status).toBe(200);
    expect(res.text).toContain("SPA");
    expect(res.type).toBe("text/html");
  });

  it("GET /api/health is NOT shadowed by the SPA fallback", async () => {
    const res = await request(app.getHttpServer()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("GET /health (unprefixed infra probe) is NOT shadowed by the SPA fallback", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status");
  });

  it("GET /api/some-unknown-route 404s with the JSON {error,code} shape, not the SPA html", async () => {
    const res = await request(app.getHttpServer()).get("/api/some-unknown-route");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("code");
    expect(res.text).not.toContain("SPA");
  });
});
