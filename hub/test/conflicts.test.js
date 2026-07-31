import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, api } from "./helpers.js";

async function setup(url, email = "conf@x.com") {
  const userToken = (await api(url, "POST", "/api/auth/signup", { body: { email, password: "pw123456" } })).body.token;
  const machine = (await api(url, "POST", "/api/machines", { token: userToken, body: { name: "Laptop" } })).body;
  const project = (await api(url, "POST", "/api/projects", { token: userToken, body: { alias: "app" } })).body;
  await api(url, "PUT", `/api/projects/${project.id}/mappings/${machine.id}`, {
    token: userToken, body: { local_path: "/p" },
  });
  return { userToken, machineToken: machine.token, projectId: project.id };
}

test("true conflict opens a conflict + notification, then resolves to candidate", async () => {
  const srv = await startTestServer();
  try {
    const { userToken, machineToken, projectId } = await setup(srv.url);
    const fn = "sess.jsonl";

    // canonical
    const p1 = await api(srv.url, "POST", `/api/agent/push/${projectId}`, {
      machineToken, body: { filename: fn, content: '{"t":1}\n{"t":2}\n', base_hash: null },
    });
    const hashA = p1.body.hash;

    // advance canonical so the next push has a stale base
    await api(srv.url, "POST", `/api/agent/push/${projectId}`, {
      machineToken, body: { filename: fn, content: '{"t":1}\n{"t":2}\n{"t":3}\n', base_hash: hashA },
    });

    // stale base + non-JSON tail => true conflict
    const conf = await api(srv.url, "POST", `/api/agent/push/${projectId}`, {
      machineToken, body: { filename: fn, content: '{"t":1}\nEDITED-BY-HAND\n', base_hash: hashA },
    });
    assert.equal(conf.status, 409);
    assert.equal(conf.body.status, "conflict");
    const conflictId = conf.body.conflictId;

    // conflict listed for project and for user
    const projConflicts = await api(srv.url, "GET", `/api/projects/${projectId}/conflicts`, { token: userToken });
    assert.equal(projConflicts.body.length, 1);
    const allConflicts = await api(srv.url, "GET", "/api/conflicts", { token: userToken });
    assert.equal(allConflicts.body.length, 1);
    assert.equal(allConflicts.body[0].project_alias, "app");

    // resolve keeping the candidate (the hand-edited version)
    const resolved = await api(srv.url, "POST", `/api/projects/${projectId}/conflicts/${conflictId}/resolve`, {
      token: userToken, body: { choice: "candidate" },
    });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.choice, "candidate");

    // canonical now equals the candidate content
    const pull = await fetch(`${srv.url}/api/agent/pull/${projectId}/${fn}`, {
      headers: { "x-machine-token": machineToken },
    });
    assert.equal(await pull.text(), '{"t":1}\nEDITED-BY-HAND\n');

    // conflict list is now empty
    assert.equal((await api(srv.url, "GET", "/api/conflicts", { token: userToken })).body.length, 0);
  } finally {
    await srv.close();
  }
});

test("auto-merge on append divergence records a resolved auto_merged conflict", async () => {
  const srv = await startTestServer();
  try {
    const { userToken, machineToken, projectId } = await setup(srv.url, "am@x.com");
    const fn = "m.jsonl";
    const p1 = await api(srv.url, "POST", `/api/agent/push/${projectId}`, {
      machineToken, body: { filename: fn, content: '{"timestamp":"a","x":0}\n', base_hash: null },
    });
    // advance canonical
    await api(srv.url, "POST", `/api/agent/push/${projectId}`, {
      machineToken, body: { filename: fn, content: '{"timestamp":"a","x":0}\n{"timestamp":"c","x":1}\n', base_hash: p1.body.hash },
    });
    // stale base, JSON tail -> auto-merge
    const merged = await api(srv.url, "POST", `/api/agent/push/${projectId}`, {
      machineToken, body: { filename: fn, content: '{"timestamp":"a","x":0}\n{"timestamp":"b","x":2}\n', base_hash: p1.body.hash },
    });
    assert.equal(merged.status, 200);
    assert.equal(merged.body.status, "merged");
    // no OPEN conflict remains (auto-merge resolves immediately)
    assert.equal((await api(srv.url, "GET", "/api/conflicts", { token: userToken })).body.length, 0);
  } finally {
    await srv.close();
  }
});
