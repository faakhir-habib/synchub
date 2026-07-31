import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer, api } from "../../hub/test/helpers.js";
import { createApi } from "../src/api.js";
import { createState } from "../src/state.js";
import { reconcileAll } from "../src/reconcile.js";

function tmp(prefix) { return mkdtempSync(join(tmpdir(), prefix)); }

async function bootstrap(url) {
  const userToken = (await api(url, "POST", "/api/auth/signup", { body: { email: "ag@x.com", password: "pw123456" } })).body.token;
  const mA = (await api(url, "POST", "/api/machines", { token: userToken, body: { name: "A" } })).body;
  const mB = (await api(url, "POST", "/api/machines", { token: userToken, body: { name: "B" } })).body;
  const project = (await api(url, "POST", "/api/projects", { token: userToken, body: { alias: "app" } })).body;
  const localA = tmp("synchub-A-");
  const localB = tmp("synchub-B-");
  await api(url, "PUT", `/api/projects/${project.id}/mappings/${mA.id}`, { token: userToken, body: { local_path: localA } });
  await api(url, "PUT", `/api/projects/${project.id}/mappings/${mB.id}`, { token: userToken, body: { local_path: localB } });
  return { userToken, mA, mB, project, localA, localB };
}

test("agent reconcile pushes local files and pulls hub files", async () => {
  const srv = await startTestServer();
  try {
    const { mA, mB, project, localA } = await bootstrap(srv.url);

    // Machine A has a local transcript the Hub hasn't seen.
    writeFileSync(join(localA, "a.jsonl"), '{"t":1}\n');
    const apiA = createApi({ hubUrl: srv.url, machineToken: mA.token });
    const stateA = createState(join(tmp("synchub-stateA-"), "state.json"));

    await reconcileAll(apiA, stateA);

    // Hub now has a.jsonl (pushed by A).
    const man1 = await apiA.getManifest(project.id);
    assert.ok(man1.data.some((f) => f.filename === "a.jsonl"), "a.jsonl pushed to hub");
    assert.equal(stateA.get(project.id, "a.jsonl") != null, true);

    // Machine B pushes b.jsonl straight to the Hub.
    const apiB = createApi({ hubUrl: srv.url, machineToken: mB.token });
    const pB = await apiB.push(project.id, "b.jsonl", '{"t":9}\n', null);
    assert.equal(pB.data.status, "accepted");

    // A reconciles again -> pulls b.jsonl into its local folder.
    await reconcileAll(apiA, stateA);
    assert.ok(existsSync(join(localA, "b.jsonl")), "b.jsonl pulled locally");
    assert.equal(readFileSync(join(localA, "b.jsonl"), "utf8"), '{"t":9}\n');
  } finally {
    await srv.close();
  }
});

test("agent reconcile pulls auto-merged content after divergent pushes", async () => {
  const srv = await startTestServer();
  try {
    const { mA, mB, project, localA } = await bootstrap(srv.url);
    const apiA = createApi({ hubUrl: srv.url, machineToken: mA.token });
    const apiB = createApi({ hubUrl: srv.url, machineToken: mB.token });
    const stateA = createState(join(tmp("synchub-stateA2-"), "state.json"));

    // A establishes canonical, then B extends it (forward), then A has a
    // divergent append based on the original -> hub auto-merges on A's push.
    writeFileSync(join(localA, "s.jsonl"), '{"timestamp":"a"}\n');
    await reconcileAll(apiA, stateA);
    const base = stateA.get(project.id, "s.jsonl");

    await apiB.push(project.id, "s.jsonl", '{"timestamp":"a"}\n{"timestamp":"c"}\n', base);

    // A appends a different line based on the original base, then reconciles.
    writeFileSync(join(localA, "s.jsonl"), '{"timestamp":"a"}\n{"timestamp":"b"}\n');
    await reconcileAll(apiA, stateA);

    // A's local file now contains the merged union (b before c by timestamp).
    const merged = readFileSync(join(localA, "s.jsonl"), "utf8");
    assert.match(merged, /"timestamp":"b"/);
    assert.match(merged, /"timestamp":"c"/);
  } finally {
    await srv.close();
  }
});
