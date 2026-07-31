import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, api } from "./helpers.js";

async function signup(url, email = "m@x.com") {
  const r = await api(url, "POST", "/api/auth/signup", { body: { email, password: "pw123456" } });
  return r.body.token;
}

test("create, list, delete machines (token shown once on create)", async () => {
  const srv = await startTestServer();
  try {
    const token = await signup(srv.url);
    const created = await api(srv.url, "POST", "/api/machines", { token, body: { name: "Laptop" } });
    assert.equal(created.status, 201);
    assert.ok(created.body.token, "machine token returned at creation");
    const id = created.body.id;

    const list = await api(srv.url, "GET", "/api/machines", { token });
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].token, undefined, "token hidden in list");

    const del = await api(srv.url, "DELETE", `/api/machines/${id}`, { token });
    assert.equal(del.status, 200);
    assert.equal((await api(srv.url, "GET", "/api/machines", { token })).body.length, 0);
  } finally {
    await srv.close();
  }
});

test("pairing code issue + redeem creates a machine", async () => {
  const srv = await startTestServer();
  try {
    const token = await signup(srv.url, "pair@x.com");
    const pair = await api(srv.url, "POST", "/api/machines/pair", { token });
    assert.equal(pair.status, 201);
    const code = pair.body.code;

    const redeem = await api(srv.url, "POST", "/api/agent/pair/redeem", {
      body: { code, name: "Desktop", os: "Windows" },
    });
    assert.equal(redeem.status, 201);
    assert.ok(redeem.body.machineToken);

    const list = await api(srv.url, "GET", "/api/machines", { token });
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].name, "Desktop");
  } finally {
    await srv.close();
  }
});
