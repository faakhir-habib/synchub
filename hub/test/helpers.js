import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function testApp() {
  const relayDir = mkdtempSync(join(tmpdir(), "synchub-relay-"));
  return createApp(openDb(":memory:"), { relayDir });
}

// Starts the app on an ephemeral port. Returns { url, close }.
export async function startTestServer(app = testApp()) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

// Small fetch wrapper: api(base, method, path, { body, token, machineToken })
export async function api(base, method, path, opts = {}) {
  const headers = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.machineToken) headers["x-machine-token"] = opts.machineToken;
  const res = await fetch(base + path, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, body: json };
}
