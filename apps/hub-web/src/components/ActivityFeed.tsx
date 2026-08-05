import type { LucideIcon } from "lucide-react";
import { UploadCloud, RefreshCw, Activity } from "lucide-react";
import type { ActivityEvent } from "@/lib/endpoints";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtBytes, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

interface EventStyle {
  icon: LucideIcon;
  label: string;
  className: string;
}

const EVENT_STYLES: Record<string, EventStyle> = {
  push: { icon: UploadCloud, label: "File pushed", className: "bg-info/10 text-info" },
  sync_now: { icon: RefreshCw, label: "Manual sync", className: "bg-primary/10 text-primary" },
};

const FALLBACK_STYLE: EventStyle = {
  icon: Activity,
  label: "Sync event",
  className: "bg-muted text-muted-foreground",
};

function styleFor(type: string): EventStyle {
  return EVENT_STYLES[type] ?? { ...FALLBACK_STYLE, label: type };
}

function ActivityRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-1 py-3">
      <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-48" />
      </div>
      <Skeleton className="h-3 w-12 shrink-0" />
    </div>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const { icon: Icon, label, className } = styleFor(event.type);
  return (
    <div className="flex items-center gap-3 px-1 py-3">
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", className)}>
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {event.filename && (
          <p className="truncate font-mono text-xs text-muted-foreground">{event.filename}</p>
        )}
      </div>
      {event.bytes > 0 && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{fmtBytes(event.bytes)}</span>
      )}
      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(event.created_at)}</span>
    </div>
  );
}

interface ActivityFeedProps {
  events?: ActivityEvent[];
  isLoading?: boolean;
}

/** Recent sync activity — pushes and manual syncs. */
export function ActivityFeed({ events, isLoading = false }: ActivityFeedProps) {
  if (isLoading) {
    return (
      <div className="divide-y divide-border/60" data-testid="activity-skeleton">
        {Array.from({ length: 6 }).map((_, i) => (
          <ActivityRowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-muted-foreground">
          <Activity className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium text-foreground">No activity yet</p>
        <p className="max-w-[22rem] text-xs text-muted-foreground">
          Pushes and syncs across your projects will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/60">
      {events.map((event) => (
        <ActivityRow key={event.id} event={event} />
      ))}
    </div>
  );
}
