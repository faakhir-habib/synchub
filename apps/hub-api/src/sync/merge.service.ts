import { Injectable } from "@nestjs/common";

// Append-only auto-merge for JSONL transcripts. Ported verbatim from
// hub/src/lib/merge.js — behavior must not change.
//
// The common divergence: two machines shared an identical prefix, then each
// appended different lines. We merge = shared prefix + union of both tails,
// ordered by each line's own `timestamp` field. If any tail line isn't valid
// JSON (e.g. a session was edited/rewound, not just appended), we can't safely
// merge and report a true conflict for manual resolution.

export type MergeKind = "behind" | "forward" | "merged" | "conflict";

export interface MergeResult {
  kind: MergeKind;
  merged: string | null;
}

function splitLines(s: string): string[] {
  if (!s) return [];
  return s.replace(/\n$/, "").split("\n");
}

function longestCommonPrefix(a: string[], b: string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

@Injectable()
export class MergeService {
  // Returns one of:
  //   { kind: "behind",   merged }  incoming is a prefix of canonical — keep canonical
  //   { kind: "forward",  merged }  canonical is a prefix of incoming — take incoming
  //   { kind: "merged",   merged }  both appended — union, timestamp-ordered
  //   { kind: "conflict", merged: null }  not safely mergeable
  autoMerge(canonical: string, incoming: string): MergeResult {
    const A = splitLines(canonical);
    const B = splitLines(incoming);
    const p = longestCommonPrefix(A, B);
    const aTail = A.slice(p);
    const bTail = B.slice(p);

    if (bTail.length === 0) return { kind: "behind", merged: canonical };
    if (aTail.length === 0) return { kind: "forward", merged: incoming };

    // Union of both tails, dropping exact-duplicate lines.
    const seen = new Set<string>();
    const tail: string[] = [];
    for (const line of [...aTail, ...bTail]) {
      if (!seen.has(line)) {
        seen.add(line);
        tail.push(line);
      }
    }

    const parsed = tail.map((l) => ({ l, o: parseLine(l) as { timestamp?: unknown } | null }));
    if (parsed.some((x) => x.o === null)) return { kind: "conflict", merged: null };

    parsed.sort((x, y) => {
      const tx = x.o!.timestamp;
      const ty = y.o!.timestamp;
      if (tx == null || ty == null) return 0; // stable: keep insertion order
      return tx < ty ? -1 : tx > ty ? 1 : 0;
    });

    const merged = [...A.slice(0, p), ...parsed.map((x) => x.l)].join("\n") + "\n";
    return { kind: "merged", merged };
  }
}
