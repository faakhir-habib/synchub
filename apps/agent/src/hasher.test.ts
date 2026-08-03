import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { hashContent, hashFile } from "./hasher.js";

describe("hashContent", () => {
  it("matches the server's sha256 for a known input", () => {
    expect(hashContent("x")).toBe(
      "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
    );
  });

  it("produces a stable hex digest for the empty string", () => {
    const h = hashContent("");
    expect(h).toBe(hashContent(""));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a stable hex digest for a multi-char string", () => {
    const h1 = hashContent("hello world, this is SyncHub");
    const h2 = hashContent("hello world, this is SyncHub");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hashFile", () => {
  it("streams a file to the same digest hashContent produces for its text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "synchub-hashfile-"));
    try {
      const body = "line one\nline two\némigré unicode ☃\n".repeat(1000);
      const path = join(dir, "transcript.jsonl");
      writeFileSync(path, body, "utf8");

      expect(await hashFile(path)).toBe(hashContent(body));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("matches hashContent('') for an empty file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "synchub-hashfile-"));
    try {
      const path = join(dir, "empty.jsonl");
      writeFileSync(path, "", "utf8");

      expect(await hashFile(path)).toBe(hashContent(""));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
