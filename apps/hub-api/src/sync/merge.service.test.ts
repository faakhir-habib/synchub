import { describe, expect, it } from "vitest";
import { MergeService } from "./merge.service.js";

// Ports the algorithm in hub/src/lib/merge.js exactly: shared prefix +
// union of both tails, ordered by each line's own `timestamp` field. If any
// tail line isn't valid JSON, report a true conflict for manual resolution.
describe("MergeService#autoMerge", () => {
  const svc = new MergeService();

  // --- ported verbatim from hub/test/merge.test.js ---

  it("forward extension is taken as-is", () => {
    const m = svc.autoMerge('{"t":1}\n', '{"t":1}\n{"t":2}\n');
    expect(m.kind).toBe("forward");
    expect(m.merged).toBe('{"t":1}\n{"t":2}\n');
  });

  it("incoming behind canonical keeps canonical", () => {
    const m = svc.autoMerge('{"t":1}\n{"t":2}\n', '{"t":1}\n');
    expect(m.kind).toBe("behind");
    expect(m.merged).toBe('{"t":1}\n{"t":2}\n');
  });

  it("append-only divergence auto-merges by timestamp", () => {
    const canonical =
      '{"timestamp":"2026-01-01T00:00:00Z","m":"base"}\n{"timestamp":"2026-01-01T00:00:05Z","m":"A"}\n';
    const incoming =
      '{"timestamp":"2026-01-01T00:00:00Z","m":"base"}\n{"timestamp":"2026-01-01T00:00:03Z","m":"B"}\n';
    const m = svc.autoMerge(canonical, incoming);
    expect(m.kind).toBe("merged");
    const lines = m.merged!.replace(/\n$/, "").split("\n");
    // shared base first, then B (t=3) before A (t=5)
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/"m":"B"/);
    expect(lines[2]).toMatch(/"m":"A"/);
  });

  it("non-JSON tail (rewrite) is a true conflict", () => {
    const m = svc.autoMerge('{"t":1}\n{"t":2}\n', '{"t":1}\nGARBAGE-NOT-JSON\n');
    expect(m.kind).toBe("conflict");
    expect(m.merged).toBeNull();
  });

  // --- additional cases ---

  it("both sides append different new lines after a shared prefix: merges union ordered by timestamp", () => {
    const shared = '{"timestamp":"2026-01-01T00:00:00Z","m":"base"}\n';
    const canonical =
      shared +
      '{"timestamp":"2026-01-01T00:00:10Z","m":"A1"}\n{"timestamp":"2026-01-01T00:00:30Z","m":"A2"}\n';
    const incoming =
      shared +
      '{"timestamp":"2026-01-01T00:00:20Z","m":"B1"}\n{"timestamp":"2026-01-01T00:00:40Z","m":"B2"}\n';
    const m = svc.autoMerge(canonical, incoming);
    expect(m.kind).toBe("merged");
    expect(m.merged!.endsWith("\n")).toBe(true);
    const lines = m.merged!.replace(/\n$/, "").split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/"m":"base"/);
    expect(lines[1]).toMatch(/"m":"A1"/); // t=10
    expect(lines[2]).toMatch(/"m":"B1"/); // t=20
    expect(lines[3]).toMatch(/"m":"A2"/); // t=30
    expect(lines[4]).toMatch(/"m":"B2"/); // t=40
  });

  it("incoming is a strict prefix of canonical -> behind", () => {
    const canonical = '{"timestamp":1}\n{"timestamp":2}\n{"timestamp":3}\n';
    const incoming = '{"timestamp":1}\n{"timestamp":2}\n';
    const m = svc.autoMerge(canonical, incoming);
    expect(m.kind).toBe("behind");
    expect(m.merged).toBe(canonical);
  });

  it("canonical is a strict prefix of incoming -> forward, merged === incoming", () => {
    const canonical = '{"timestamp":1}\n{"timestamp":2}\n';
    const incoming = '{"timestamp":1}\n{"timestamp":2}\n{"timestamp":3}\n';
    const m = svc.autoMerge(canonical, incoming);
    expect(m.kind).toBe("forward");
    expect(m.merged).toBe(incoming);
  });

  it("a tail line that is not valid JSON -> conflict, merged === null", () => {
    // both sides diverge (non-empty aTail AND bTail) so we actually reach the
    // union/parse step rather than short-circuiting on forward/behind.
    const canonical = '{"timestamp":1}\n{"timestamp":5}\n';
    const incoming = '{"timestamp":1}\nNOT-JSON-AT-ALL\n';
    const m = svc.autoMerge(canonical, incoming);
    expect(m.kind).toBe("conflict");
    expect(m.merged).toBeNull();
  });

  it("identical canonical and incoming -> behind (bTail empty)", () => {
    const content = '{"timestamp":1}\n{"timestamp":2}\n';
    const m = svc.autoMerge(content, content);
    expect(m.kind).toBe("behind");
    expect(m.merged).toBe(content);
  });

  it("exact-duplicate tail lines on both sides are de-duplicated, not doubled", () => {
    // Each side's *first* tail line differs (so they diverge before the
    // duplicate and it isn't absorbed into the common prefix); each side's
    // *second* tail line is the exact same string, exercising the seen-set
    // dedup in the union step rather than longestCommonPrefix.
    const shared = '{"timestamp":0,"m":"base"}\n';
    const aLine = '{"timestamp":10,"m":"A"}';
    const bLine = '{"timestamp":15,"m":"B"}';
    const dupLine = '{"timestamp":20,"m":"dup"}';
    const canonical = shared + aLine + "\n" + dupLine + "\n";
    const incoming = shared + bLine + "\n" + dupLine + "\n";
    const m = svc.autoMerge(canonical, incoming);
    expect(m.kind).toBe("merged");
    const lines = m.merged!.replace(/\n$/, "").split("\n");
    // shared base + A + B + dup (once) = 4 lines, not 5
    expect(lines).toHaveLength(4);
    expect(lines.filter((l) => l === dupLine)).toHaveLength(1);
    expect(lines).toEqual([shared.trimEnd(), aLine, bLine, dupLine]);
  });
});
