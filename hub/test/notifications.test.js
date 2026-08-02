import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startTestServer, api } from "./helpers.js";

async function setup(url, email = "note@x.com") {
  const userToken = (await api(url, "POST", "/api/auth/signup", { body: { email, password: "pw123456" } })).body.token;
  const machine = (await api(url, "POST", "/api/machines", { token: userToken, body: { name: "L" } })).body;
  const project = (await api(url, "POST", "/api/projects", { token: userToken, body: { alias: "app" } })).body;
  await api(url, "PUT", `/api/projects/${project.id}/mappings/${machine.id}`, { token: userToken, body: { local_path: "/p" } });
  return { userToken, machineToken: machine.token, projectId: project.id };
}

// Force a true conflict (records a "conflict" notification).
async function makeConflict(url, machineToken, projectId, fn = "x.jsonl") {
  const p1 = await api(url, "POST", `/api/agent/push/${projectId}`, { machineToken, body: { filename: fn, content: '{"t":1}\n', base_hash: null } });
  await api(url, "POST", `/api/agent/push/${projectId}`, { machineToken, body: { filename: fn, content: '{"t":1}\n{"t":2}\n', base_hash: p1.body.hash } });
  await api(url, "POST", `/api/agent/push/${projectId}`, { machineToken, body: { filename: fn, content: '{"t":1}\nHAND\n', base_hash: p1.body.hash } });
}

test("notifications list, mark-read, read-all", async () => {
  const srv = await startTestServer();
  try {
    const { userToken, machineToken, projectId } = await setup(srv.url);
    await makeConflict(srv.url, machineToken, projectId);

    let list = (await api(srv.url, "GET", "/api/notifications", { token: userToken })).body;
    assert.ok(list.unread >= 1);
    const conflictNote = list.items.find((n) => n.type === "conflict");
    assert.ok(conflictNote);

    await api(srv.url, "POST", `/api/notifications/${conflictNote.id}/read`, { token: userToken });
    let after = (await api(srv.url, "GET", "/api/notifications", { token: userToken })).body;
    assert.equal(after.unread, list.unread - 1);

    await api(srv.url, "POST", "/api/notifications/read-all", { token: userToken });
    assert.equal((await api(srv.url, "GET", "/api/notifications", { token: userToken })).body.unread, 0);
  } finally {
    await srv.close();
  }
});

test("personal webhook receives relayed notification", async () => {
  // capture server for the user's webhook
  const received = [];
  let resolveHit;
  const hit = new Promise((r) => { resolveHit = r; });
  const capture = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { received.push(JSON.parse(b || "{}")); res.end("ok"); resolveHit(); });
  });
  await new Promise((r) => capture.listen(0, r));
  const webhookUrl = `http://127.0.0.1:${capture.address().port}/hook`;

  const srv = await startTestServer();
  try {
    const { userToken, machineToken, projectId } = await setup(srv.url, "hook@x.com");
    await api(srv.url, "PUT", "/api/auth/me/notify-webhook", { token: userToken, body: { url: webhookUrl } });

    await makeConflict(srv.url, machineToken, projectId);

    await Promise.race([hit, new Promise((_, rej) => setTimeout(() => rej(new Error("webhook timeout")), 2000))]);
    assert.ok(received.length >= 1);
    assert.equal(received[0].type, "conflict");
    assert.match(received[0].title, /Conflict/);
  } finally {
    await srv.close();
    await new Promise((r) => capture.close(r));
  }
});
