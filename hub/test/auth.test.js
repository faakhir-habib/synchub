import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, api } from "./helpers.js";

test("signup then me returns the user; bad login rejected", async () => {
  const srv = await startTestServer();
  try {
    const signup = await api(srv.url, "POST", "/api/auth/signup", {
      body: { email: "x@y.com", password: "secretpw" },
    });
    assert.equal(signup.status, 201);
    const token = signup.body.token;
    assert.ok(token);

    const me = await api(srv.url, "GET", "/api/auth/me", { token });
    assert.equal(me.status, 200);
    assert.equal(me.body.email, "x@y.com");

    const bad = await api(srv.url, "POST", "/api/auth/login", {
      body: { email: "x@y.com", password: "wrong" },
    });
    assert.equal(bad.status, 401);

    const good = await api(srv.url, "POST", "/api/auth/login", {
      body: { email: "x@y.com", password: "secretpw" },
    });
    assert.equal(good.status, 200);
    assert.ok(good.body.token);
  } finally {
    await srv.close();
  }
});

test("PUT /me updates name; GET /me returns it", async () => {
  const srv = await startTestServer();
  try {
    const token = (await api(srv.url, "POST", "/api/auth/signup", { body: { email: "n@n.com", password: "pw123456" } })).body.token;
    let me = await api(srv.url, "GET", "/api/auth/me", { token });
    assert.equal(me.body.name, null);
    const upd = await api(srv.url, "PUT", "/api/auth/me", { token, body: { name: "Faakhir Habib", notify_webhook_url: "https://x/y" } });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.name, "Faakhir Habib");
    me = await api(srv.url, "GET", "/api/auth/me", { token });
    assert.equal(me.body.name, "Faakhir Habib");
    assert.equal(me.body.notify_webhook_url, "https://x/y");
  } finally {
    await srv.close();
  }
});

test("me without token is 401; duplicate signup is 409", async () => {
  const srv = await startTestServer();
  try {
    assert.equal((await api(srv.url, "GET", "/api/auth/me")).status, 401);
    await api(srv.url, "POST", "/api/auth/signup", { body: { email: "d@d.com", password: "pw123456" } });
    const dup = await api(srv.url, "POST", "/api/auth/signup", { body: { email: "d@d.com", password: "pw123456" } });
    assert.equal(dup.status, 409);
  } finally {
    await srv.close();
  }
});
