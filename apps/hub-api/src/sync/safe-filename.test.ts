import { describe, expect, it } from "vitest";

import { isSafeFilename } from "./sync.service.js";

describe("hub isSafeFilename", () => {
  it.each([
    ["session.jsonl"],
    ["a.jsonl"],
    ["no-extension"],
    ["memory/MEMORY.md"],
    ["memory/notes.md"],
    ["memory/My-Note_1.md"],
  ])("accepts %j", (name) => {
    expect(isSafeFilename(name)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["a/b", "bare separator"],
    ["memory/notes.txt", "memory file not .md"],
    ["memory/a/b.md", "nested under memory"],
    ["memory/..md", "dot-dot in memory basename"],
    ["memory/", "empty memory basename"],
    ["memory/..", "memory parent traversal"],
    ["notes/foo.md", "non-memory subfolder"],
  ])("rejects %j (%s)", (name) => {
    expect(isSafeFilename(name)).toBe(false);
  });

  it("rejects a name longer than 255 chars", () => {
    expect(isSafeFilename("a".repeat(256))).toBe(false);
  });
});
