import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, api } from "./helpers.js";

async function bootstrap(url) {
  const token = (await api(url, "POST", "/api/auth/signup", { body: { email: "map@x.com", password: "pw123456" } })).body.token;
  const machine = (await api(url, "POST", "/api/machines", { token, body: { name: "Laptop" } })).body;
  const project = (await api(url, "POST", "/api/projects", { token, body: { alias: "my-app" } })).body;
  return { token, machineId: machine.id, projectId: project.id };
}

test("add, list, remove a machine->folder mapping", async () => {
  const srv = await startTestServer();
  try {
    const { token, machineId, projectId } = await bootstrap(srv.url);
    const put = await api(srv.url, "PUT", `/api/projects/${projectId}/mappings/${machineId}`, {
      token, body: { local_path: "/home/me/.claude/projects/abc" },
    });
    assert.equal(put.status, 200);
    assert.equal(put.body.local_path, "/home/me/.claude/projects/abc");

    const detail = await api(srv.url, "GET", `/api/projects/${projectId}`, { token });
    assert.equal(detail.body.mappings.length, 1);

    const del = await api(srv.url, "DELETE", `/api/projects/${projectId}/mappings/${machineId}`, { token });
    assert.equal(del.status, 200);
    assert.equal((await api(srv.url, "GET", `/api/projects/${projectId}`, { token })).body.mappings.length, 0);
  } finally {
    await srv.close();
  }
});
