import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, api } from "./helpers.js";

async function setup(url, email = "dash@x.com") {
  const userToken = (await api(url, "POST", "/api/auth/signup", { body: { email, password: "pw123456" } })).body.token;
  const machine = (await api(url, "POST", "/api/machines", { token: userToken, body: { name: "L" } })).body;
  const project = (await api(url, "POST", "/api/projects", { token: userToken, body: { alias: "app" } })).body;
  await api(url, "PUT", `/api/projects/${project.id}/mappings/${machine.id}`, { token: userToken, body: { local_path: "/p" } });
  return { userToken, machineToken: machine.token, projectId: project.id };
}

test("metrics reflect pushes, sessions, and open conflicts", async () => {
  const srv = await startTestServer();
  try {
    const { userToken, machineToken, projectId } = await setup(srv.url);

    await api(srv.url, "POST", `/api/agent/push/${projectId}`, { machineToken, body: { filename: "a.jsonl", content: '{"t":1}\n', base_hash: null } });
    await api(srv.url, "POST", `/api/agent/push/${projectId}`, { machineToken, body: { filename: "b.jsonl", content: '{"t":1}\n', base_hash: null } });

    let m = (await api(srv.url, "GET", "/api/dashboard/metrics", { token: userToken })).body;
    assert.equal(m.projects.total, 1);
    assert.equal(m.machines.total, 1);
    assert.equal(m.sessionsSyncedToday, 2);
    assert.ok(m.eventsToday >= 2);
    assert.ok(m.dataTransferredBytes > 0);
    assert.equal(m.openConflicts, 0);
    assert.equal(m.syncSuccessRate, 100);

    // create a true conflict
    const p1 = await api(srv.url, "POST", `/api/agent/push/${projectId}`, { machineToken, body: { filename: "c.jsonl", content: '{"t":1}\n', base_hash: null } });
    await api(srv.url, "POST", `/api/agent/push/${projectId}`, { machineToken, body: { filename: "c.jsonl", content: '{"t":1}\n{"t":2}\n', base_hash: p1.body.hash } });
    await api(srv.url, "POST", `/api/agent/push/${projectId}`, { machineToken, body: { filename: "c.jsonl", content: '{"t":1}\nHAND\n', base_hash: p1.body.hash } });

    m = (await api(srv.url, "GET", "/api/dashboard/metrics", { token: userToken })).body;
    assert.equal(m.openConflicts, 1);
    assert.ok(m.syncSuccessRate < 100);

    const activity = (await api(srv.url, "GET", "/api/dashboard/activity", { token: userToken })).body;
    assert.ok(Array.isArray(activity) && activity.length > 0);
  } finally {
    await srv.close();
  }
});
