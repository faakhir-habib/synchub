// End-to-end integration test: boots the REAL hub-api (built + spawned as a
// separate process against a fresh, migrated, throwaway SQLite DB — the same
// "real server" topology as production, not an in-process Nest testing
// module), pairs a machine through the agent's own real `pairRedeem`, wires
// up a project + mapping through the real authenticated REST API, and then
// drives the agent's real `runAgent` against a temp local directory.
//
// Why a child process instead of `Test.createTestingModule([AppModule])`
// in-process (the pattern hub-api's own e2e suites use): hub-api's NestJS
// providers rely on `emitDecoratorMetadata` (reflect-metadata-based DI, see
// apps/hub-api/vitest.config.ts's `unplugin-swc` plugin) which the agent
// workspace's default esbuild-based vitest transform does not produce —
// importing AppModule directly from here would silently break Nest's
// constructor-parameter type resolution. Spawning hub-api's own built
// `dist/main.js` (via `pnpm build`, the same artifact `pnpm start` runs)
// sidesteps that entirely, requires zero changes to either workspace's
// toolchain/deps, and arguably exercises a MORE realistic boundary: the
// agent talks to hub-api purely over HTTP + WS, exactly as in production.
//
// This is still "the real hub-api", not a fake/mock server — the whole
// point of this suite is to catch wire-contract drift (route names, frame
// shapes, field names) that unit-level mocks in agent.test.ts/ws.test.ts/
// reconcile.test.ts can't.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createApi, pairRedeem } from "../src/api.js";
import type { Api } from "../src/api.js";
import { runAgent } from "../src/agent.js";
import type { AgentConfig } from "../src/config.js";
import { hashContent } from "../src/hasher.js";

const TEST_FILE_DIR = dirname(fileURLToPath(import.meta.url)); // apps/agent/test
const AGENT_ROOT = join(TEST_FILE_DIR, ".."); // apps/agent
const REPO_ROOT = join(AGENT_ROOT, "..", ".."); // repo root
const HUB_API_DIR = join(REPO_ROOT, "apps", "hub-api");

const TEST_ROOT = join(tmpdir(), "synchub-agent-integration-e2e");
const DB_PATH = join(TEST_ROOT, "db", "test.db");
const RELAY_DIR = join(TEST_ROOT, "relay");
const LOCAL_A = join(TEST_ROOT, "localA");
const LOCAL_B = join(TEST_ROOT, "localB");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounded-iteration polling helper — never uses Date.now, so it's a fixed, deterministic number of attempts. */
async function waitFor(
  pred: () => boolean | Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number; message?: string } = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 150;
  const timeoutMs = opts.timeoutMs ?? 20000;
  const iterations = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < iterations; i++) {
    if (await pred()) return;
    await sleep(intervalMs);
  }
  throw new Error(opts.message ?? `waitFor: condition not met within ${timeoutMs}ms`);
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      srv.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("could not determine a free port"));
      });
    });
  });
}

function sqliteUrl(absPath: string): string {
  return `file:${absPath.replace(/\\/g, "/")}`;
}

/** Runs a setup command (pnpm build / prisma migrate deploy) and throws with full output on failure. */
function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const res = spawnSync(cmd, args, { cwd, env, shell: true, encoding: "utf8", timeout: 120000 });
  if (res.status !== 0) {
    throw new Error(
      `"${cmd} ${args.join(" ")}" (cwd=${cwd}) failed with status ${String(res.status)}\n` +
        `--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`,
    );
  }
}

let hubProcess: ChildProcess;
let hubStdout = "";
let hubStderr = "";
let baseUrl: string;

let sessionToken: string;
let machineTokenA: string;
let machineIdA: number;
let machineTokenB: string;
let projectAuto: { id: number };
let projectManual: { id: number };
let apiA: Api;
let cfgA: AgentConfig;

async function fetchJson<T>(
  method: string,
  path: string,
  opts: { auth?: string; body?: unknown } = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(opts.auth ? { Authorization: `Bearer ${opts.auth}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

let stateCounter = 0;
function stateFile(): string {
  stateCounter += 1;
  return join(TEST_ROOT, `state-${stateCounter}.json`);
}

beforeAll(async () => {
  await rm(TEST_ROOT, { recursive: true, force: true });
  await mkdir(dirname(DB_PATH), { recursive: true });
  await mkdir(RELAY_DIR, { recursive: true });
  await mkdir(LOCAL_A, { recursive: true });
  await mkdir(LOCAL_B, { recursive: true });

  // 1. Build the real hub-api (same artifact `pnpm --filter @synchub/hub-api
  // start` runs) so this suite always exercises the CURRENT branch's wire
  // contract, not a stale dist/. Deliberately `nest build` only, NOT the
  // package's full `pnpm build` (which also runs `prisma generate`): when
  // this suite runs alongside hub-api's OWN vitest suite (e.g. `pnpm -r
  // test`, which runs workspace packages in parallel), that other process
  // already has the shared @prisma/client query-engine DLL loaded/mapped,
  // and Windows refuses to rename a new engine binary over one that's in
  // use elsewhere (EPERM). The client is already generated by the
  // workspace's `postinstall` hook and the schema hasn't changed here, so
  // regenerating it is both unnecessary and, on Windows, unsafe to do
  // concurrently.
  run("pnpm", ["exec", "nest", "build"], HUB_API_DIR, process.env);

  // 2. Fresh, isolated SQLite DB, migrated from hub-api's real migrations —
  // never touches the shared dev.db that hub-api's own e2e suites use.
  const dbUrl = sqliteUrl(DB_PATH);
  run(
    "pnpm",
    ["exec", "prisma", "migrate", "deploy", "--schema=prisma/schema.prisma"],
    HUB_API_DIR,
    { ...process.env, DATABASE_URL: dbUrl },
  );

  // 3. Spawn the real server as a child process against that DB + a throwaway relay store.
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;

  hubProcess = spawn(process.execPath, [join(HUB_API_DIR, "dist", "main.js")], {
    cwd: HUB_API_DIR,
    env: { ...process.env, DATABASE_URL: dbUrl, RELAY_STORE_DIR: RELAY_DIR, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  hubProcess.stdout?.on("data", (d: Buffer) => (hubStdout += d.toString()));
  hubProcess.stderr?.on("data", (d: Buffer) => (hubStderr += d.toString()));

  let exited = false;
  hubProcess.once("exit", () => {
    exited = true;
  });

  await waitFor(
    async () => {
      if (exited) {
        throw new Error(
          `hub-api process exited before becoming healthy.\n--- stdout ---\n${hubStdout}\n--- stderr ---\n${hubStderr}`,
        );
      }
      try {
        const res = await fetch(`${baseUrl}/health`);
        return res.ok;
      } catch {
        return false;
      }
    },
    { timeoutMs: 30000, intervalMs: 200, message: "hub-api did not become healthy in time" },
  );

  // 4. Real user + real pairing flow (through the agent's OWN pairRedeem,
  // not a raw fetch) for two machines under one user.
  const signup = await fetchJson<{ token: string; user: { id: number } }>("POST", "/api/auth/signup", {
    body: { email: "agent-integration@example.com", password: "password123" },
  });
  expect(signup.status).toBe(201);
  sessionToken = signup.body.token;

  const pairA = await fetchJson<{ code: string }>("POST", "/api/machines/pair", { auth: sessionToken });
  expect(pairA.status).toBe(201);
  const redeemA = await pairRedeem(baseUrl, pairA.body.code, { name: "machine-a", agent_version: "test" });
  if (!redeemA.ok) throw new Error(`pairRedeem A failed: ${redeemA.kind}`);
  machineTokenA = redeemA.data.machineToken;
  machineIdA = redeemA.data.machineId;

  const pairB = await fetchJson<{ code: string }>("POST", "/api/machines/pair", { auth: sessionToken });
  expect(pairB.status).toBe(201);
  const redeemB = await pairRedeem(baseUrl, pairB.body.code, { name: "machine-b", agent_version: "test" });
  if (!redeemB.ok) throw new Error(`pairRedeem B failed: ${redeemB.kind}`);
  machineTokenB = redeemB.data.machineToken;

  // 5. Real project + mapping wiring through the authenticated REST API.
  const createAuto = await fetchJson<{ id: number }>("POST", "/api/projects", {
    auth: sessionToken,
    body: { alias: "auto-project", sync_mode: "auto" },
  });
  expect(createAuto.status).toBe(201);
  projectAuto = { id: createAuto.body.id };

  const mapA = await fetchJson("PUT", `/api/projects/${projectAuto.id}/mappings/${machineIdA}`, {
    auth: sessionToken,
    body: { local_path: LOCAL_A },
  });
  expect(mapA.status).toBe(200);

  // machineB is only ever driven via raw pushes to the Hub (simulating "the
  // other side") — it never runs a local agent in this suite, so its
  // local_path is never touched on disk.
  const mapB = await fetchJson("PUT", `/api/projects/${projectAuto.id}/mappings/${redeemB.data.machineId}`, {
    auth: sessionToken,
    body: { local_path: join(TEST_ROOT, "machineB-virtual") },
  });
  expect(mapB.status).toBe(200);

  const createManual = await fetchJson<{ id: number }>("POST", "/api/projects", {
    auth: sessionToken,
    body: { alias: "manual-project", sync_mode: "manual" },
  });
  expect(createManual.status).toBe(201);
  projectManual = { id: createManual.body.id };

  const mapManualA = await fetchJson("PUT", `/api/projects/${projectManual.id}/mappings/${machineIdA}`, {
    auth: sessionToken,
    body: { local_path: LOCAL_B },
  });
  expect(mapManualA.status).toBe(200);

  apiA = createApi({ hubUrl: baseUrl, machineToken: machineTokenA });
  cfgA = { hubUrl: baseUrl, machineToken: machineTokenA, machineId: machineIdA, notifications: false };
}, 180000);

afterAll(async () => {
  if (hubProcess && hubProcess.exitCode === null && !hubProcess.killed) {
    const exitPromise = new Promise<void>((resolve) => {
      hubProcess.once("exit", () => resolve());
    });
    hubProcess.kill();
    await Promise.race([exitPromise, sleep(5000)]);
  }

  // Windows can hold the sqlite file/handles briefly after the process
  // dies — retry the cleanup a few bounded times rather than failing.
  for (let i = 0; i < 10; i++) {
    try {
      await rm(TEST_ROOT, { recursive: true, force: true });
      break;
    } catch {
      await sleep(300);
    }
  }
}, 30000);

describe("agent <-> hub-api end-to-end (real server, real pairing, real wire contract)", () => {
  it("local -> hub push: a locally-written file is picked up and pushed, and the Hub manifest reflects it", async () => {
    const content = '{"seq":1,"timestamp":100}\n{"seq":2,"timestamp":200}\n';
    await writeFile(join(LOCAL_A, "session.jsonl"), content, "utf8");

    const handle = runAgent(cfgA, { statePath: stateFile() });
    try {
      await waitFor(
        async () => {
          const man = await apiA.getManifest(projectAuto.id);
          if (!man.ok) return false;
          const entry = man.data.find((f) => f.filename === "session.jsonl");
          return entry !== undefined && entry.hash === hashContent(content);
        },
        { timeoutMs: 20000, message: "session.jsonl never appeared in the Hub manifest with the right hash" },
      );
    } finally {
      await handle.stop();
    }
  }, 30000);

  it("hub -> agent live pull via WS 'changed': a file pushed by a SECOND machine is pulled down live", async () => {
    const logs: string[] = [];
    const handle = runAgent(cfgA, { statePath: stateFile(), log: (m) => logs.push(m) });
    try {
      await handle.whenIdle();
      await waitFor(() => Promise.resolve(logs.some((l) => l.includes("ws connected"))), {
        timeoutMs: 10000,
        message: "agent's WS never reported connected",
      });

      const content = '{"seq":1,"timestamp":100,"from":"machineB"}\n';
      const apiB = createApi({ hubUrl: baseUrl, machineToken: machineTokenB });
      const pushRes = await apiB.push(projectAuto.id, "from-b.jsonl", content, null);
      expect(pushRes.ok).toBe(true);
      if (pushRes.ok) expect(pushRes.data.status).toBe("accepted");

      await waitFor(
        async () => {
          const text = await readFile(join(LOCAL_A, "from-b.jsonl"), "utf8").catch(() => null);
          return text === content;
        },
        { timeoutMs: 20000, message: "from-b.jsonl was never pulled down onto localA via the WS 'changed' frame" },
      );
    } finally {
      await handle.stop();
    }
  }, 30000);

  it("local delete -> hub removal, with no resurrection on the next reconcile", async () => {
    const logs: string[] = [];
    // Short tick so a periodic auto-reconcile actually runs within the test window.
    const handle = runAgent(cfgA, { statePath: stateFile(), log: (m) => logs.push(m), tickMs: 500 });
    try {
      await handle.whenIdle();
      await waitFor(() => Promise.resolve(logs.some((l) => l.includes("ws connected"))), {
        timeoutMs: 10000,
        message: "agent's WS never reported connected",
      });

      await rm(join(LOCAL_A, "session.jsonl"), { force: true });

      await waitFor(
        async () => {
          const man = await apiA.getManifest(projectAuto.id);
          return man.ok && !man.data.some((f) => f.filename === "session.jsonl");
        },
        { timeoutMs: 20000, message: "session.jsonl's file_state was never removed on the Hub after local delete" },
      );

      // Let at least a couple more periodic reconciles run and confirm the
      // tombstone holds: the Hub manifest staying caught-up must not
      // resurrect the file back onto localA.
      await sleep(1500);
      expect(existsSync(join(LOCAL_A, "session.jsonl"))).toBe(false);
      const man = await apiA.getManifest(projectAuto.id);
      expect(man.ok).toBe(true);
      if (man.ok) expect(man.data.some((f) => f.filename === "session.jsonl")).toBe(false);
    } finally {
      await handle.stop();
    }
  }, 30000);

  it("sync-trigger reconciles a manual-mode project (not auto-pushed on boot, but IS pushed on an explicit sync-now)", async () => {
    const content = '{"seq":1,"timestamp":100}\n';
    await writeFile(join(LOCAL_B, "manual.jsonl"), content, "utf8");

    const logs: string[] = [];
    const handle = runAgent(cfgA, { statePath: stateFile(), log: (m) => logs.push(m) });
    try {
      await handle.whenIdle();
      await waitFor(() => Promise.resolve(logs.some((l) => l.includes("ws connected"))), {
        timeoutMs: 10000,
        message: "agent's WS never reported connected",
      });

      // Negative: boot/periodic auto-reconcile only covers sync_mode "auto"
      // projects — give it a beat, then confirm the manual project's file
      // was NOT auto-pushed.
      await sleep(1000);
      const before = await apiA.getManifest(projectManual.id);
      expect(before.ok).toBe(true);
      if (before.ok) expect(before.data.length).toBe(0);

      // Positive: a real user-facing "sync now" REST call makes the Hub emit
      // a genuine WS sync-trigger frame to every mapped agent (regardless of
      // sync_mode) -> the running agent's dispatch("sync-trigger") handler
      // reconciles that one manual project.
      const syncNow = await fetchJson<{ status: string }>(
        "POST",
        `/api/projects/${projectManual.id}/sync-now`,
        { auth: sessionToken },
      );
      expect(syncNow.status).toBe(200);
      expect(syncNow.body.status).toBe("triggered");

      await waitFor(
        async () => {
          const man = await apiA.getManifest(projectManual.id);
          if (!man.ok) return false;
          const entry = man.data.find((f) => f.filename === "manual.jsonl");
          return entry !== undefined && entry.hash === hashContent(content);
        },
        { timeoutMs: 20000, message: "manual.jsonl was never pushed after the sync-now-triggered sync-trigger" },
      );
    } finally {
      await handle.stop();
    }
  }, 30000);
});
