import { diffArrays } from "diff";

import { cn } from "@/lib/utils";

interface ConflictDiffViewProps {
  /** The currently-synced version (what's on other machines right now). */
  canonical: string;
  /** The pushed version that caused the conflict. */
  candidate: string;
}

interface DiffRow {
  canonical: string | null;
  candidate: string | null;
  kind: "same" | "removed" | "added" | "change";
}

// JSONL files end with a trailing newline; drop it before splitting so we
// don't diff a spurious trailing empty line. Mirrors MergeService.splitLines
// (apps/hub-api/src/sync/merge.service.ts) — same file format, same convention.
function splitLines(content: string): string[] {
  if (!content) return [];
  return content.replace(/\n$/, "").split("\n");
}

/**
 * Aligns a line-level diff into side-by-side rows, git-style: unchanged
 * lines land on the same row in both columns; a removed block immediately
 * followed by an added block (the common "line was edited" case) is zipped
 * row-by-row into paired "change" rows instead of stacking all removals
 * above all additions, which keeps related lines visually aligned.
 */
function buildRows(canonical: string, candidate: string): DiffRow[] {
  const changes = diffArrays(splitLines(canonical), splitLines(candidate));
  const rows: DiffRow[] = [];

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];

    if (!change.added && !change.removed) {
      for (const line of change.value) {
        rows.push({ canonical: line, candidate: line, kind: "same" });
      }
      continue;
    }

    if (change.removed) {
      const next = changes[i + 1];
      if (next?.added) {
        const removedLines = change.value;
        const addedLines = next.value;
        const max = Math.max(removedLines.length, addedLines.length);
        for (let j = 0; j < max; j++) {
          rows.push({
            canonical: j < removedLines.length ? removedLines[j] : null,
            candidate: j < addedLines.length ? addedLines[j] : null,
            kind: "change",
          });
        }
        i++; // consume the paired "added" block too
        continue;
      }
      for (const line of change.value) {
        rows.push({ canonical: line, candidate: null, kind: "removed" });
      }
      continue;
    }

    // change.added, not preceded by a paired "removed" (that case is
    // consumed via the lookahead above).
    for (const line of change.value) {
      rows.push({ canonical: null, candidate: line, kind: "added" });
    }
  }

  return rows;
}

function DiffCell({
  content,
  highlight,
}: {
  content: string | null;
  highlight: "removed" | "added" | null;
}) {
  return (
    <div
      className={cn(
        "min-w-0 whitespace-pre-wrap break-all px-3 py-1 font-mono text-xs",
        highlight === "removed" && "bg-destructive/10 text-destructive",
        highlight === "added" && "bg-success/10 text-success",
        content === null && "text-muted-foreground/40",
      )}
    >
      {content ?? " "}
    </div>
  );
}

export function ConflictDiffView({ canonical, candidate }: ConflictDiffViewProps) {
  const rows = buildRows(canonical, candidate);

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        Both versions are empty.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="grid grid-cols-2 border-b border-border bg-muted/40 text-xs font-semibold text-foreground">
        <div className="px-3 py-1.5">Current (synced)</div>
        <div className="border-l border-border px-3 py-1.5">Incoming (pushed)</div>
      </div>
      <div className="max-h-[40vh] overflow-y-auto overflow-x-auto">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-2 border-b border-border/50 last:border-b-0">
            <DiffCell
              content={row.canonical}
              highlight={row.kind === "removed" || row.kind === "change" ? "removed" : null}
            />
            <div className="border-l border-border">
              <DiffCell
                content={row.candidate}
                highlight={row.kind === "added" || row.kind === "change" ? "added" : null}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
