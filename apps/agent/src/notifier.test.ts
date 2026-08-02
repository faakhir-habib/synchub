import { describe, expect, it } from "vitest";

import { createNotifier } from "./notifier.js";

describe("createNotifier", () => {
  it("never throws when disabled", async () => {
    const notifier = createNotifier(false);
    await expect(Promise.resolve(notifier.notify("title", "message"))).resolves.not.toThrow();
  });

  it("never throws when enabled, even if the platform/module is unavailable", async () => {
    const notifier = createNotifier(true);
    await expect(Promise.resolve(notifier.notify("title", "message"))).resolves.not.toThrow();
  });
});
