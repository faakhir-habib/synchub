import { describe, expect, it } from "vitest";

import { isSafeFilename } from "./safe-filename.js";

describe("isSafeFilename", () => {
  it.each([
    ["../evil.jsonl", "parent-dir traversal"],
    ["../x", "parent-dir traversal, short"],
    ["a/b", "forward-slash separator"],
    ["a\\b", "backslash separator"],
    ["/abs/path.jsonl", "absolute unix path"],
    ["C:\\abs\\path.jsonl", "absolute windows path"],
    ["", "empty string"],
    ["..", "bare dot-dot"],
    ["...", "triple dot"],
    ["a\0b", "embedded NUL"],
  ])("rejects %j (%s)", (name) => {
    expect(isSafeFilename(name)).toBe(false);
  });

  it.each([
    ["session.jsonl"],
    ["a.jsonl"],
    ["My-File_123.jsonl"],
    ["no-extension"],
  ])("accepts %j", (name) => {
    expect(isSafeFilename(name)).toBe(true);
  });

  it("rejects a name longer than 255 chars", () => {
    expect(isSafeFilename("a".repeat(256))).toBe(false);
  });

  it("accepts a name exactly 255 chars", () => {
    expect(isSafeFilename("a".repeat(255))).toBe(true);
  });
});
