import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startTestServer, api } from "./helpers.js";

function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

// Resolve with the first JSON message matching `predicate` (default: any non-welcome).
function nextMessage(ws, predicate = (m) => m.type !== "welcome", timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws message timeout")), timeoutMs);
    const onMsg = (data) => {
      const msg = JSON.parse(data.toString());
      if (predicate(msg)) { clearTimeout(timer); ws.off("message", onMsg); resolve(msg); }
    };
    ws.on("message", onMsg);
  });
}

async function setupTwoMachines(url) {
  const userToken = (await api(url, "POST", "/api/auth/signup", { body: { email: "rt@x.com", password: "pw123456" } })).body.token;
  const a = (await api(url, "POST", "/api/machines", { token: userToken, body: { name: "A" } })).body;
  const b = (await api(url, "POST", "/api/machines", { token: userToken, body: { name: "B" } })).body;
  const project = (await api(url, "POST", "/api/projects", { token: userToken, body: { alias: "app" } })).body;
  for (const m of [a, b]) {
    await api(url, "PUT", `/api/projects/${project.id}/mappings/${m.id}`, { token: userToken, body: { local_path: "/p" } });
  }
  return { userToken, a, b, projectId: project.id };
}

test("push fans out a 'changed' message to other mapped agents", async () => {
  const srv = await startTestServer();
  let wsB;
  try {
    const { a, b, projectId } = await setupTwoMachines(srv.url);
    wsB = await openWs(`${srv.wsUrl}/ws/agent?token=${b.token}`);
    // (registration is guaranteed by the time the client 'open' resolves)
    const changed = nextMessage(wsB, (m) => m.type === "changed");
    await api(srv.url, "POST", `/api/agent/push/${projectId}`, {
      machineToken: a.token, body: { filename: "x.jsonl", content: "hi\n", base_hash: null },
    });
    const msg = await changed;
    assert.equal(msg.projectId, projectId);
    assert.equal(msg.filename, "x.jsonl");
  } finally {
    wsB?.close();
    await srv.close();
  }
});

test("user WS receives a live notification on conflict", async () => {
  const srv = await startTestServer();
  let wsU;
  try {
    const { userToken, a, projectId } = await setupTwoMachines(srv.url);
    wsU = await openWs(`${srv.wsUrl}/ws/user?token=${userToken}`);
    const noteP = nextMessage(wsU, (m) => m.type === "notification");
    const fn = "c.jsonl";
    const p1 = await api(srv.url, "POST", `/api/agent/push/${projectId}`, {
      machineToken: a.token, body: { filename: fn, content: '{"t":1}\n', base_hash: null },
    });
    await api(srv.url, "POST", `/api/agent/push/${projectId}`, {
      machineToken: a.token, body: { filename: fn, content: '{"t":1}\n{"t":2}\n', base_hash: p1.body.hash },
    });
    await api(srv.url, "POST", `/api/agent/push/${projectId}`, {
      machineToken: a.token, body: { filename: fn, content: '{"t":1}\nHAND-EDIT\n', base_hash: p1.body.hash },
    });
    const note = await noteP;
    assert.equal(note.notification.type, "conflict");
  } finally {
    wsU?.close();
    await srv.close();
  }
});

test("machine goes online on WS connect and offline on close", async () => {
  const srv = await startTestServer();
  try {
    const { userToken, b } = await setupTwoMachines(srv.url);
    const ws = await openWs(`${srv.wsUrl}/ws/agent?token=${b.token}`);

    let list = (await api(srv.url, "GET", "/api/machines", { token: userToken })).body;
    assert.equal(list.find((m) => m.id === b.id).status, "online");

    await new Promise((r) => { ws.once("close", r); ws.close(); });
    await new Promise((r) => setTimeout(r, 50)); // let server process close

    list = (await api(srv.url, "GET", "/api/machines", { token: userToken })).body;
    assert.equal(list.find((m) => m.id === b.id).status, "offline");
  } finally {
    await srv.close();
  }
});

test("agent WS with a bad token is rejected", async () => {
  const srv = await startTestServer();
  try {
    await assert.rejects(openWs(`${srv.wsUrl}/ws/agent?token=nope`));
  } finally {
    await srv.close();
  }
});
