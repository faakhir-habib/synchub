import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  FolderKanban,
  Server,
  GitPullRequestArrow,
  CheckCircle2,
  Activity as ActivityIcon,
  HardDrive,
  Gauge,
  Files,
} from "lucide-react";
import { getMetrics, getActivity } from "@/lib/endpoints";
import { qk } from "@/lib/query-keys";
import { StatCard } from "@/components/StatCard";
import { ActivityFeed } from "@/components/ActivityFeed";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { fmtBytes } from "@/lib/format";

function EngineStat({
  label,
  value,
  icon: Icon,
  isLoading,
}: {
  label: string;
  value?: ReactNode;
  icon: LucideIcon;
  isLoading?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-muted-foreground">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {isLoading ? (
          <Skeleton className="mt-1 h-4 w-12" />
        ) : (
          <p className="mt-0.5 truncate font-display text-sm font-bold tabular-nums text-foreground">
            {value}
          </p>
        )}
      </div>
    </div>
  );
}

export function Dashboard() {
  const metrics = useQuery({ queryKey: qk.dashboardMetrics, queryFn: getMetrics });
  const activity = useQuery({ queryKey: qk.activity, queryFn: () => getActivity(20) });

  const m = metrics.data;
  const metricsLoading = metrics.isPending;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A live overview of your projects, machines, and sync activity.
        </p>
      </header>

      {metrics.isError ? (
        <ErrorPanel error={metrics.error} />
      ) : (
        <section
          aria-label="Key metrics"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <StatCard
            label="Active projects"
            icon={FolderKanban}
            accent="primary"
            isLoading={metricsLoading}
            value={m?.projects.total}
            hint={m ? `${m.projects.syncing} syncing now` : undefined}
          />
          <StatCard
            label="Connected machines"
            icon={Server}
            accent="info"
            isLoading={metricsLoading}
            value={m?.machines.total}
            hint={m ? `${m.machines.online} online` : undefined}
          />
          <StatCard
            label="Open conflicts"
            icon={GitPullRequestArrow}
            accent={m && m.openConflicts > 0 ? "warning" : "success"}
            isLoading={metricsLoading}
            value={m?.openConflicts}
            hint={m ? (m.openConflicts > 0 ? "Needs review" : "All clear") : undefined}
          />
          <StatCard
            label="Sync success rate"
            icon={CheckCircle2}
            accent="success"
            isLoading={metricsLoading}
            value={m ? `${Math.round(m.syncSuccessRate * 100)}%` : undefined}
            hint="Last 24 hours"
          />
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Recent activity</CardTitle>
            <CardDescription>Pushes, merges, and conflicts across every project.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {activity.isError ? (
              <ErrorPanel error={activity.error} />
            ) : (
              <ActivityFeed events={activity.data} isLoading={activity.isPending} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Sync engine</CardTitle>
            <CardDescription>Today&rsquo;s throughput at a glance.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 pt-0">
            <EngineStat
              label="Events today"
              icon={ActivityIcon}
              isLoading={metricsLoading}
              value={metrics.isError ? "—" : m?.eventsToday}
            />
            <EngineStat
              label="Data transferred"
              icon={HardDrive}
              isLoading={metricsLoading}
              value={metrics.isError ? "—" : m ? fmtBytes(m.dataTransferredBytes) : undefined}
            />
            <EngineStat
              label="Avg latency"
              icon={Gauge}
              isLoading={metricsLoading}
              value={
                metrics.isError ? "—" : m ? (m.avgLatencyMs != null ? `${m.avgLatencyMs}ms` : "—") : undefined
              }
            />
            <EngineStat
              label="Files synced"
              icon={Files}
              isLoading={metricsLoading}
              value={metrics.isError ? "—" : m?.sessionsSyncedToday}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
