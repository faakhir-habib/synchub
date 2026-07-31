import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers.js";

test("serves login page, theme css, and session helper", async () => {
  const srv = await startTestServer();
  try {
    const login = await fetch(srv.url + "/login.html");
    assert.equal(login.status, 200);
    assert.match(await login.text(), /SyncHub/);

    const css = await fetch(srv.url + "/assets/css/theme.css");
    assert.equal(css.status, 200);

    const js = await fetch(srv.url + "/js/session.js");
    assert.equal(js.status, 200);

    const root = await fetch(srv.url + "/", { redirect: "manual" });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get("location"), "/login.html");
  } finally {
    await srv.close();
  }
});
