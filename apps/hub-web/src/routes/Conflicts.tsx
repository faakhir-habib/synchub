import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, GitMerge } from "lucide-react";
import { getConflicts, type ConflictWithProjectAlias } from "@/lib/endpoints";
import { qk } from "@/lib/query-keys";
import { timeAgo } from "@/lib/format";
import { ErrorPanel } from "@/components/ErrorPanel";
import { ResolveConflictDialog } from "@/components/ResolveConflictDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function ConflictsTableSkeleton() {
  return (
    <TableBody>
      {Array.from({ length: 3 }).map((_, i) => (
        <TableRow key={i}>
          <TableCell>
            <Skeleton className="h-4 w-28" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-40" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-16" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-20 rounded-md" />
          </TableCell>
          <TableCell className="text-right">
            <Skeleton className="ml-auto h-8 w-20 rounded-md" />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/40 py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-success/10 text-success">
        <CircleCheck className="h-6 w-6" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">No conflicts &mdash; everything&rsquo;s in sync</p>
        <p className="max-w-[24rem] text-sm text-muted-foreground">
          Diverging edits that need your decision will show up here as soon as one turns up.
        </p>
      </div>
    </div>
  );
}

/**
 * Conflicts screen — every open conflict across all of the user's projects,
 * newest first (the API already filters to `status: "open"` and orders by
 * `created_at desc`, so there's no client-side filtering here). Live via
 * `qk.conflicts`: RealtimeProvider invalidates it on every WS `conflict`
 * frame, and ResolveConflictDialog invalidates it again on a successful
 * resolve, so this list needs no polling of its own.
 */
export function Conflicts() {
  const conflicts = useQuery({ queryKey: qk.conflicts, queryFn: getConflicts });
  const [resolving, setResolving] = useState<ConflictWithProjectAlias | null>(null);

  const list = conflicts.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Conflicts
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Diverging edits that need your decision.</p>
      </header>

      {conflicts.isError ? (
        <ErrorPanel error={conflicts.error} />
      ) : conflicts.isPending ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Detected</TableHead>
                <TableHead>Merge</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <ConflictsTableSkeleton />
          </Table>
        </div>
      ) : list.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Detected</TableHead>
                <TableHead>Merge</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((conflict) => (
                <TableRow key={conflict.id}>
                  <TableCell>
                    <Link
                      to="/projects/$id"
                      params={{ id: String(conflict.project_id) }}
                      className="font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {conflict.project_alias}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {conflict.filename}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{timeAgo(conflict.created_at)}</TableCell>
                  <TableCell>
                    {conflict.auto_merged && (
                      <Badge variant="secondary" className="gap-1">
                        <GitMerge className="h-3 w-3" />
                        auto-merged
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" onClick={() => setResolving(conflict)}>
                      Resolve
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ResolveConflictDialog
        open={resolving !== null}
        onOpenChange={(next) => {
          if (!next) setResolving(null);
        }}
        conflict={resolving}
      />
    </div>
  );
}
