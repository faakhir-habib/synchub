import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, api } from "./helpers.js";

test("health endpoint responds ok", async () => {
  const srv = await startTestServer();
  try {
    const { status, body } = await api(srv.url, "GET", "/api/health");
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
  } finally {
    await srv.close();
  }
});
