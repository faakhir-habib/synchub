import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, api } from "./helpers.js";

// Sets up a user with one machine mapped into one project.
// Returns { userToken, machineToken, machineId, projectId }.
async function setup(url, email = "agent@x.com") {
  const userToken = (await api(url, "POST", "/api/auth/signup", { body: { email, password: "pw123456" } })).body.token;
  const machine = (await api(url, "POST", "/api/machines", { token: userToken, body: { name: "Laptop" } })).body;
  const project = (await api(url, "POST", "/api/projects", { token: userToken, body: { alias: "my-app" } })).body;
  await api(url, "PUT", `/api/projects/${project.id}/mappings/${machine.id}`, {
    token: userToken, body: { local_path: "/home/me/.claude/projects/abc" },
  });
  return { userToken, machineToken: machine.token, machineId: machine.id, projectId: project.id };
}

test("agent mappings lists mapped projects with mode + path", async () => {
  const srv = await startTestServer();
  try {
    const { machineToken, projectId } = await setup(srv.url);
    const res = await api(srv.url, "GET", "/api/agent/mappings", { machineToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].project_id, projectId);
    assert.equal(res.body[0].alias, "my-app");
    assert.equal(res.body[0].sync_mode, "auto");
    assert.equal(res.body[0].local_path, "/home/me/.claude/projects/abc");
  } finally {
    await srv.close();
  }
});

test("push -> manifest -> pull round-trip; forward update; conflict on stale base", async () => {
  const srv = await startTestServer();
  try {
    const { machineToken, projectId } = await setup(srv.url);
    const fn = "5f2c-uuid.jsonl";

    // initial push (never synced -> base_hash null)
    const p1 = await api(srv.url, "POST", `/api/agent/push/${projectId}`, {
      machineToken, body: { filename: fn, content: '{"a":1}\n', base_hash: null },
    });
    assert.equal(p1.status, 200);
    assert.equal(p1.body.status, "accepted");
    const hashA = p1.body.hash;

    // manifest now lists the file
    const man = await api(srv.url, "GET", `/api/agent/manifest/${projectId}`, { machineToken });
    assert.equal(man.body.length, 1);
    assert.equal(man.body[0].filename, fn);
    assert.equal(man.body[0].hash, hashA);

    // pull returns exact content
    const pull = await fetch(`${srv.url}/api/agent/pull/${projectId}/${fn}`, {
      headers: { "x-machine-token": machineToken },
    });
    assert.equal(pull.status, 200);
    assert.equal(await pull.text(), '{"a":1}\n');

    // forward update: base_hash matches canonical -> accepted
    const p2 = await api(srv.url, "POST", `/api/agent/push/${projectId}`, {
      machineToken, body: { filename: fn, content: '{"a":1}\n{"b":2}\n', base_hash: hashA },
    });
    assert.equal(p2.status, 200);
    assert.equal(p2.body.status, "accepted");

    // pushing again with the now-stale base_hash but valid JSON tail -> auto-merged
    const p3 = await api(srv.url, "POST", `/api/agent/push/${projectId}`, {
      machineToken, body: { filename: fn, content: '{"a":1}\n{"c":9}\n', base_hash: hashA },
    });
    assert.equal(p3.status, 200);
    assert.equal(p3.body.status, "merged");
  } finally {
    await srv.close();
  }
});

test("no-op push of identical content reports unchanged", async () => {
  const srv = await startTestServer();
  try {
    const { machineToken, projectId } = await setup(srv.url);
    const fn = "same.jsonl";
    const first = await api(srv.url, "POST", `/api/agent/push/${projectId}`, {
      machineToken, body: { filename: fn, content: "x\n", base_hash: null },
    });
    const again = await api(srv.url, "POST", `/api/agent/push/${projectId}`, {
      machineToken, body: { filename: fn, content: "x\n", base_hash: first.body.hash },
    });
    assert.equal(again.body.status, "unchanged");
  } finally {
    await srv.close();
  }
});

test("agent endpoints reject bad auth, unmapped project, unsafe filename", async () => {
  const srv = await startTestServer();
  try {
    const { machineToken, projectId } = await setup(srv.url);

    // no machine token
    assert.equal((await api(srv.url, "GET", "/api/agent/mappings")).status, 401);

    // a second machine that is NOT mapped to the project
    const other = await setup(srv.url, "other@x.com");
    const cross = await api(srv.url, "GET", `/api/agent/manifest/${projectId}`, { machineToken: other.machineToken });
    assert.equal(cross.status, 404);

    // path-traversal / unsafe filename rejected
    const bad = await api(srv.url, "POST", `/api/agent/push/${projectId}`, {
      machineToken, body: { filename: "../escape.jsonl", content: "x", base_hash: null },
    });
    assert.equal(bad.status, 400);
  } finally {
    await srv.close();
  }
});
