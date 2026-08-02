import { test } from "node:test";
import assert from "node:assert/strict";
import { autoMerge, splitLines } from "../src/lib/merge.js";

test("forward extension is taken as-is", () => {
  const m = autoMerge('{"t":1}\n', '{"t":1}\n{"t":2}\n');
  assert.equal(m.kind, "forward");
  assert.equal(m.merged, '{"t":1}\n{"t":2}\n');
});

test("incoming behind canonical keeps canonical", () => {
  const m = autoMerge('{"t":1}\n{"t":2}\n', '{"t":1}\n');
  assert.equal(m.kind, "behind");
  assert.equal(m.merged, '{"t":1}\n{"t":2}\n');
});

test("append-only divergence auto-merges by timestamp", () => {
  const canonical = '{"timestamp":"2026-01-01T00:00:00Z","m":"base"}\n{"timestamp":"2026-01-01T00:00:05Z","m":"A"}\n';
  const incoming  = '{"timestamp":"2026-01-01T00:00:00Z","m":"base"}\n{"timestamp":"2026-01-01T00:00:03Z","m":"B"}\n';
  const m = autoMerge(canonical, incoming);
  assert.equal(m.kind, "merged");
  const lines = splitLines(m.merged);
  // shared base first, then B (t=3) before A (t=5)
  assert.equal(lines.length, 3);
  assert.match(lines[1], /"m":"B"/);
  assert.match(lines[2], /"m":"A"/);
});

test("non-JSON tail (rewrite) is a true conflict", () => {
  const m = autoMerge('{"t":1}\n{"t":2}\n', '{"t":1}\nGARBAGE-NOT-JSON\n');
  assert.equal(m.kind, "conflict");
  assert.equal(m.merged, null);
});
