// End-to-end test against the Dockerized Hub at http://localhost:8080.
// Exercises: signup, pairing-code redemption, two agents, push/pull reconcile,
// auto-merge, live WebSocket 'changed' fan-out, and UI serving.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createApi, pairRedeem } from "./src/api.js";
import { createState } from "./src/state.js";
import { reconcileAll } from "./src/reconcile.js";
import { watchProjects } from "./src/watcher.js";

const BASE = process.env.HUB || "http://localhost:8080";
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
let pass = 0;
const ok = (m) => { console.log("  ✓", m); pass++; };

async function j(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  return { status: res.status, data: t ? JSON.parse(t) : null };
}

console.log("E2E against", BASE);

// 1. signup
const email = `e2e_${Date.now()}@x.com`;
const signup = await j("POST", "/api/auth/signup", { email, password: "pw123456" });
assert.equal(signup.status, 201); const userToken = signup.data.token;
ok("signup + session token");

// 2. project
const project = (await j("POST", "/api/projects", { alias: "docker-app" }, userToken)).data;
assert.ok(project.id); ok("project created");

// 3. pair two machines via pairing codes (real agent onboarding path)
async function pairMachine(name) {
  const code = (await j("POST", "/api/machines/pair", null, userToken)).data.code;
  const info = { name, os: process.platform, os_version: "test", agent_version: "0.1.0" };
  const r = await pairRedeem(BASE, code, info);
  assert.equal(r.status, 201);
  return { token: r.data.machineToken, id: r.data.machineId };
}
const A = await pairMachine("Agent-A");
const B = await pairMachine("Agent-B");
ok("two machines paired via codes");

// 4. map both to temp folders
const dirA = tmp("e2e-A-"), dirB = tmp("e2e-B-");
await j("PUT", `/api/projects/${project.id}/mappings/${A.id}`, { local_path: dirA }, userToken);
await j("PUT", `/api/projects/${project.id}/mappings/${B.id}`, { local_path: dirB }, userToken);
ok("machines mapped to folders");

const apiA = createApi({ hubUrl: BASE, machineToken: A.token });
const apiB = createApi({ hubUrl: BASE, machineToken: B.token });
const stateA = createState(join(tmp("e2e-sA-"), "s.json"));
const stateB = createState(join(tmp("e2e-sB-"), "s.json"));

// 5. A pushes a transcript, B pulls it
writeFileSync(join(dirA, "conv1.jsonl"), '{"t":1,"m":"hi"}\n');
await reconcileAll(apiA, stateA);
const man = await apiA.getManifest(project.id);
assert.ok(man.data.some((f) => f.filename === "conv1.jsonl"));
ok("agent A pushed conv1.jsonl to Hub");

await reconcileAll(apiB, stateB);
assert.ok(existsSync(join(dirB, "conv1.jsonl")));
assert.equal(readFileSync(join(dirB, "conv1.jsonl"), "utf8"), '{"t":1,"m":"hi"}\n');
ok("agent B pulled conv1.jsonl");

// 6. auto-merge on divergent append
writeFileSync(join(dirA, "s.jsonl"), '{"timestamp":"a"}\n');
await reconcileAll(apiA, stateA);
const base = stateA.get(project.id, "s.jsonl");
await apiB.push(project.id, "s.jsonl", '{"timestamp":"a"}\n{"timestamp":"c"}\n', base);
writeFileSync(join(dirA, "s.jsonl"), '{"timestamp":"a"}\n{"timestamp":"b"}\n');
await reconcileAll(apiA, stateA);
const merged = readFileSync(join(dirA, "s.jsonl"), "utf8");
assert.match(merged, /"timestamp":"b"/); assert.match(merged, /"timestamp":"c"/);
ok("divergent appends auto-merged (b + c present)");

// 7. live WebSocket 'changed' fan-out
const wsB = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws/agent?token=${encodeURIComponent(B.token)}`);
await new Promise((res, rej) => { wsB.once("open", res); wsB.once("error", rej); });
const changed = new Promise((res, rej) => {
  const timer = setTimeout(() => rej(new Error("no 'changed' in 3s")), 3000);
  wsB.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.type === "changed") { clearTimeout(timer); res(m); } });
});
writeFileSync(join(dirA, "live.jsonl"), '{"t":99}\n');
await reconcileAll(apiA, stateA); // push -> Hub fans out to B's socket
const msg = await changed;
assert.equal(msg.filename, "live.jsonl");
wsB.close();
ok("live WebSocket 'changed' fan-out received by peer");

// 8. UI + metrics served
for (const p of ["/login.html", "/dashboard.html", "/js/app-shell.js", "/assets/css/theme.css"]) {
  assert.equal((await fetch(BASE + p)).status, 200, p);
}
const metrics = (await j("GET", "/api/dashboard/metrics", null, userToken)).data;
assert.ok(metrics.eventsToday >= 3);
ok("UI assets served + dashboard metrics reflect activity");

// 9. real chokidar watcher auto-pushes a new file (no manual reconcile)
const mappingsA = (await apiA.getMappings()).data;
const watch = watchProjects(apiA, stateA, mappingsA, () => {}, () => {}, 600);
await new Promise((r) => setTimeout(r, 400)); // let the watcher settle
writeFileSync(join(dirA, "watched.jsonl"), '{"t":7,"via":"watcher"}\n');
let watched = false;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 300));
  const m = await apiA.getManifest(project.id);
  if (m.data.some((f) => f.filename === "watched.jsonl")) { watched = true; break; }
}
await watch.close();
assert.ok(watched, "watcher pushed watched.jsonl");
ok("chokidar watcher auto-pushed a new transcript on file write");

console.log(`\nALL ${pass} E2E CHECKS PASSED against Docker container.`);
