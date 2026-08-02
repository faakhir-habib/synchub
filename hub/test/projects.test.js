import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, api } from "./helpers.js";

async function signup(url, email = "p@x.com") {
  return (await api(url, "POST", "/api/auth/signup", { body: { email, password: "pw123456" } })).body.token;
}

test("project create/list/sync-mode/delete, scoped to owner", async () => {
  const srv = await startTestServer();
  try {
    const token = await signup(srv.url);
    const created = await api(srv.url, "POST", "/api/projects", { token, body: { alias: "my-app" } });
    assert.equal(created.status, 201);
    assert.equal(created.body.sync_mode, "auto");
    const id = created.body.id;

    const mode = await api(srv.url, "PUT", `/api/projects/${id}/sync-mode`, { token, body: { sync_mode: "manual" } });
    assert.equal(mode.body.sync_mode, "manual");

    const bad = await api(srv.url, "PUT", `/api/projects/${id}/sync-mode`, { token, body: { sync_mode: "nope" } });
    assert.equal(bad.status, 400);

    const otherToken = await signup(srv.url, "other@x.com");
    assert.equal((await api(srv.url, "GET", "/api/projects", { token: otherToken })).body.length, 0);

    assert.equal((await api(srv.url, "DELETE", `/api/projects/${id}`, { token })).status, 200);
  } finally {
    await srv.close();
  }
});

test("PUT /:id renames project + changes sync mode", async () => {
  const srv = await startTestServer();
  try {
    const token = await signup(srv.url, "ren@x.com");
    const id = (await api(srv.url, "POST", "/api/projects", { token, body: { alias: "old" } })).body.id;
    const res = await api(srv.url, "PUT", `/api/projects/${id}`, { token, body: { alias: "new-name", sync_mode: "manual" } });
    assert.equal(res.status, 200);
    assert.equal(res.body.alias, "new-name");
    assert.equal(res.body.sync_mode, "manual");
  } finally {
    await srv.close();
  }
});

test("duplicate alias for same user is 409", async () => {
  const srv = await startTestServer();
  try {
    const token = await signup(srv.url, "dupe@x.com");
    assert.equal((await api(srv.url, "POST", "/api/projects", { token, body: { alias: "same" } })).status, 201);
    assert.equal((await api(srv.url, "POST", "/api/projects", { token, body: { alias: "same" } })).status, 409);
  } finally {
    await srv.close();
  }
});
