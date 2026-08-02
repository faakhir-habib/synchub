import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCheck, Info, MailCheck, RefreshCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/endpoints";
import { qk } from "@/lib/query-keys";
import { timeAgo } from "@/lib/format";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type NotificationItem = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
};

const TYPE_DISPLAY: Record<string, { label: string; icon: ReactNode; badgeClassName: string }> = {
  conflict: {
    label: "conflict",
    icon: <TriangleAlert className="h-4 w-4" />,
    badgeClassName: "border-transparent bg-destructive/15 text-destructive",
  },
  sync: {
    label: "sync",
    icon: <RefreshCw className="h-4 w-4" />,
    badgeClassName: "border-transparent bg-success/15 text-success",
  },
};

function typeDisplay(type: string) {
  return (
    TYPE_DISPLAY[type] ?? {
      label: type || "info",
      icon: <Info className="h-4 w-4" />,
      badgeClassName: "border-transparent bg-info/15 text-info",
    }
  );
}

function NotificationsSkeleton() {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-4">
          <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-3.5 w-72" />
          </div>
          <Skeleton className="h-3.5 w-14 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/40 py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-success/10 text-success">
        <MailCheck className="h-6 w-6" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">You&rsquo;re all caught up</p>
        <p className="max-w-[24rem] text-sm text-muted-foreground">
          Conflict alerts, sync activity, and machine status changes will show up here as they happen.
        </p>
      </div>
    </div>
  );
}

function NotificationRow({
  item,
  onMarkRead,
  pending,
}: {
  item: NotificationItem;
  onMarkRead: (id: number) => void;
  pending: boolean;
}) {
  const { label, icon, badgeClassName } = typeDisplay(item.type);

  return (
    <div
      data-notification-id={item.id}
      data-read={item.read}
      className={cn(
        "flex items-start gap-3 px-4 py-4 transition-colors",
        !item.read && "bg-primary/[0.04]",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg",
          badgeClassName,
        )}
      >
        {icon}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {!item.read && (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
            />
          )}
          <p className="text-sm font-semibold text-foreground">{item.title}</p>
          <Badge variant="outline" className={cn("gap-1 border-transparent", badgeClassName)}>
            {label}
          </Badge>
        </div>
        {item.body && <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className="text-xs text-muted-foreground">{timeAgo(item.created_at)}</span>
        {!item.read && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={pending}
            onClick={() => onMarkRead(item.id)}
          >
            {pending ? "Marking…" : "Mark read"}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Notifications screen — every notification for the current user, newest
 * first (the API already orders by `created_at desc`). Live via
 * `qk.notifications`: RealtimeProvider invalidates it on every WS
 * `notification` frame (and toasts the title), so this list needs no polling
 * of its own — the same pattern as Conflicts.
 */
export function Notifications() {
  const notifications = useQuery({ queryKey: qk.notifications, queryFn: getNotifications });
  const queryClient = useQueryClient();

  const markOne = useMutation({
    mutationFn: (id: number) => markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.notifications });
    },
  });

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.notifications });
      toast.success("All notifications marked read");
    },
  });

  const items = notifications.data?.items ?? [];
  const unread = notifications.data?.unread ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Conflict alerts, sync activity, and machine status changes.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={unread === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          <CheckCheck className="h-4 w-4" />
          {markAll.isPending ? "Marking all…" : "Mark all read"}
        </Button>
      </header>

      {notifications.isError ? (
        <ErrorPanel error={notifications.error} />
      ) : notifications.isPending ? (
        <NotificationsSkeleton />
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              onMarkRead={(id) => markOne.mutate(id)}
              pending={markOne.isPending && markOne.variables === item.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
