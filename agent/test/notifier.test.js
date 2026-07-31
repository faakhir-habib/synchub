import { test } from "node:test";
import assert from "node:assert/strict";
import { createNotifier } from "../src/notifier.js";

test("disabled notifier is a safe no-op", async () => {
  const n = createNotifier(false);
  await assert.doesNotReject(n.notify("t", "m"));
});

test("enabled notifier never throws even if the platform can't toast", async () => {
  const n = createNotifier(true);
  // Should resolve regardless of whether a toast backend is available.
  await assert.doesNotReject(n.notify("SyncHub test", "hello"));
});
