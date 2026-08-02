import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SyncMode } from "@synchub/shared";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Files,
  FolderKanban,
  GitPullRequestArrow,
  Plus,
  RefreshCw,
  Server,
} from "lucide-react";
import { toast } from "sonner";
import {
  getProject,
  getProjectConflicts,
  setProjectSyncMode,
  syncNow,
  type ActivityEvent,
} from "@/lib/endpoints";
import { qk } from "@/lib/query-keys";
import { ApiError } from "@/lib/api-error";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useProjectProgress } from "@/realtime/progress-store";
import { StatCard } from "@/components/StatCard";
import { ActivityFeed } from "@/components/ActivityFeed";
import { ErrorPanel } from "@/components/ErrorPanel";
import { AddMappingDialog } from "@/components/AddMappingDialog";
import { MappingRow } from "@/components/MappingRow";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SYNC_MODE_DISPLAY: Record<SyncMode, { label: string; badgeVariant: "success" | "secondary" | "outline" }> = {
  auto: { label: "Auto", badgeVariant: "success" },
  manual: { label: "Manual", badgeVariant: "secondary" },
  stopped: { label: "Stopped", badgeVariant: "outline" },
};

const SYNC_MODE_OPTIONS: { value: SyncMode; label: string }[] = [
  { value: "auto", label: "Auto — sync continuously" },
  { value: "manual", label: "Manual — sync on demand" },
  { value: "stopped", label: "Stopped — paused" },
];

const PROGRESS_PHASE_LABEL: Record<"scan" | "push" | "pull", string> = {
  scan: "Scanning",
  push: "Pushing",
  pull: "Pulling",
};

interface SyncProgressBarProps {
  completed: number;
  total: number;
  phase: "scan" | "push" | "pull";
  filename?: string;
}

/**
 * Slim live indicator driven by `sync-progress` WS frames (progress-store).
 * Mounted only while a sync is actively streaming progress for this project;
 * disappears the moment `sync-complete` clears the store (see
 * realtime-provider.tsx's dispatch).
 */
function SyncProgressBar({ completed, total, phase, filename }: SyncProgressBarProps) {
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  return (
    <div
      data-testid="sync-progress"
      className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5"
    >
      <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs font-medium text-foreground">
            {PROGRESS_PHASE_LABEL[phase]}… {completed}/{total}
            {filename ? ` · ${filename}` : ""}
          </p>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {pct}%
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/projects"
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back to projects
    </Link>
  );
}

function ProjectDetailSkeleton() {
  return (
    <>
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-36 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCard key={i} label="" icon={Files} isLoading />
        ))}
      </div>
      <Skeleton className="h-56 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-xl lg:col-span-2" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </>
  );
}

function ProjectNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/40 py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground">
        <FolderKanban className="h-6 w-6" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">Project not found</p>
        <p className="max-w-[24rem] text-sm text-muted-foreground">
          It may have been deleted, or the link you followed is out of date.
        </p>
      </div>
      <Button asChild className="mt-1">
        <Link to="/projects">Back to projects</Link>
      </Button>
    </div>
  );
}

interface ProjectDetailProps {
  projectId: number;
}

/**
 * Project detail screen — mappings, sync controls, activity, and open
 * conflicts for a single project. Realtime already invalidates
 * `qk.project(id)` and `qk.projectConflicts(id)` on `changed`/`sync-complete`/
 * `conflict` WS frames (realtime-provider), so this refetches live with no
 * extra wiring here. `sync-progress` frames additionally drive a live
 * progress bar via progress-store (see `useProjectProgress` below), cleared
 * automatically on `sync-complete`.
 */
export function ProjectDetail({ projectId }: ProjectDetailProps) {
  const queryClient = useQueryClient();
  const [addMappingOpen, setAddMappingOpen] = useState(false);
  const progress = useProjectProgress(projectId);

  // A non-numeric route param (typo'd URL, stale bookmark) arrives here as
  // NaN. There's nothing to look up — skip the request entirely (both
  // queries are `enabled: false`) and fall straight to the not-found panel
  // below instead of ever hitting the API.
  const validId = Number.isInteger(projectId);

  const project = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => getProject(projectId),
    enabled: validId,
  });
  const conflicts = useQuery({
    queryKey: qk.projectConflicts(projectId),
    queryFn: () => getProjectConflicts(projectId),
    enabled: validId,
  });

  const syncNowMutation = useMutation({
    mutationFn: () => syncNow(projectId),
    onSuccess: () => toast.success("Sync triggered"),
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to trigger sync. Please try again.");
    },
  });

  const syncModeMutation = useMutation({
    mutationFn: (mode: SyncMode) => setProjectSyncMode(projectId, { sync_mode: mode }),
    onSuccess: () => {
      // The project detail cache updates via this invalidation; the
      // projects list needs its own nudge since it also renders the badge.
      queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
      queryClient.invalidateQueries({ queryKey: qk.projects });
      toast.success("Sync mode updated");
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to update sync mode. Please try again.");
    },
  });

  if (!validId) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <ProjectNotFound />
      </div>
    );
  }

  if (project.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <ProjectDetailSkeleton />
      </div>
    );
  }

  if (project.isError) {
    // NestJS's ParseIntPipe on this route rejects a non-numeric :id with 400,
    // not 404 — both mean "there's nothing here," and both should read as a
    // friendly not-found rather than the scarier generic ErrorPanel. (The
    // NaN case above already avoids the request entirely; this branch covers
    // an id that parses as a number but the API still rejects, e.g. an
    // out-of-range value.)
    const notFound =
      project.error instanceof ApiError &&
      (project.error.status === 404 || project.error.status === 400);
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        {notFound ? <ProjectNotFound /> : <ErrorPanel error={project.error} />}
      </div>
    );
  }

  const data = project.data;
  const { label: syncModeLabel, badgeVariant } = SYNC_MODE_DISPLAY[data.sync_mode];
  const existingMachineIds = data.mappings.map((m) => m.machine_id);
  const openConflicts = (conflicts.data ?? []).filter((c) => c.status === "open");

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {data.alias}
            </h1>
            <Badge variant={badgeVariant}>{syncModeLabel}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Created {timeAgo(data.created_at)}</p>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={data.sync_mode}
            onValueChange={(v) => syncModeMutation.mutate(v as SyncMode)}
          >
            <SelectTrigger id="project-detail-sync-mode" className="w-[10.5rem]" aria-label="Sync mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SYNC_MODE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => syncNowMutation.mutate()} disabled={syncNowMutation.isPending}>
            <RefreshCw className={cn("h-4 w-4", syncNowMutation.isPending && "animate-spin")} />
            {syncNowMutation.isPending ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </header>

      {progress ? (
        <SyncProgressBar
          completed={progress.completed}
          total={progress.total}
          phase={progress.phase}
          filename={progress.filename}
        />
      ) : null}

      <section aria-label="Project stats" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Tracked files" icon={Files} accent="primary" value={data.tracked_files} />
        <StatCard
          label="Last sync"
          icon={Clock}
          accent="info"
          value={data.last_sync_at ? timeAgo(data.last_sync_at) : "Never"}
        />
        <StatCard label="Mappings" icon={Server} accent="success" value={data.mappings.length} />
        <StatCard
          label="Open conflicts"
          icon={GitPullRequestArrow}
          accent={openConflicts.length > 0 ? "warning" : "success"}
          isLoading={conflicts.isPending}
          value={openConflicts.length}
          hint={openConflicts.length > 0 ? "Needs review" : "All clear"}
        />
      </section>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="text-lg">Machines</CardTitle>
            <CardDescription>Every machine this project syncs to.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setAddMappingOpen(true)}>
            <Plus className="h-4 w-4" />
            Add mapping
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {data.mappings.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 py-10 text-center">
              <p className="text-sm font-medium text-foreground">No machines mapped</p>
              <p className="max-w-[22rem] text-xs text-muted-foreground">
                Add one to start syncing this project to a folder on a machine.
              </p>
              <Button size="sm" variant="outline" className="mt-1" onClick={() => setAddMappingOpen(true)}>
                <Plus className="h-4 w-4" />
                Add a machine
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Machine</TableHead>
                    <TableHead>Local path</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.mappings.map((mapping) => (
                    <MappingRow
                      key={mapping.machine_id}
                      mapping={mapping}
                      projectId={projectId}
                      existingMachineIds={existingMachineIds}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Activity</CardTitle>
            <CardDescription>Pushes, merges, and conflicts for this project.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ActivityFeed events={data.activity as ActivityEvent[]} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Open conflicts</CardTitle>
            <CardDescription>Files that need a manual pick.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {conflicts.isError ? (
              <ErrorPanel error={conflicts.error} />
            ) : openConflicts.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-success/10 text-success">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
                <p className="text-xs text-muted-foreground">No open conflicts.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <ul className="space-y-2">
                  {openConflicts.slice(0, 5).map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2"
                    >
                      <span className="truncate font-mono text-xs text-foreground">{c.filename}</span>
                      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-warning">
                        Needs resolution
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/conflicts"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  Resolve in Conflicts
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AddMappingDialog
        projectId={projectId}
        existingMachineIds={existingMachineIds}
        open={addMappingOpen}
        onOpenChange={setAddMappingOpen}
      />
    </div>
  );
}
