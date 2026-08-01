import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FolderKanban,
  Server,
  GitPullRequestArrow,
  Bell,
  Settings,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PresenceDot, type PresenceDotProps } from "@/components/PresenceDot";
import { useRealtimeStatus } from "@/realtime/realtime-provider";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/projects", label: "Projects", icon: FolderKanban, exact: false },
  { to: "/machines", label: "Machines", icon: Server, exact: false },
  { to: "/conflicts", label: "Conflicts", icon: GitPullRequestArrow, exact: false },
  { to: "/notifications", label: "Notifications", icon: Bell, exact: false },
  { to: "/settings", label: "Settings", icon: Settings, exact: false },
] as const;

interface SidebarProps {
  /** Mobile off-canvas visibility — ignored above the `md` breakpoint. */
  open: boolean;
  onClose: () => void;
}

// Maps the live WebSocket connection state (see RealtimeProvider) onto the
// sidebar footer's dot + label. "connected" is a steady green pulse,
// "reconnecting" an amber pulse (still trying, not dead), "idle" a static
// muted dot (no session yet / intentionally not connected).
const SYNC_STATUS_DISPLAY: Record<
  ReturnType<typeof useRealtimeStatus>,
  Pick<PresenceDotProps, "online" | "pulse" | "tone"> & { label: string }
> = {
  connected: { online: true, pulse: true, tone: "success", label: "Operational" },
  reconnecting: { online: true, pulse: true, tone: "warning", label: "Reconnecting…" },
  idle: { online: false, pulse: false, label: "Offline" },
};

export function Sidebar({ open, onClose }: SidebarProps) {
  const realtimeStatus = useRealtimeStatus();
  const { online, pulse, tone, label } = SYNC_STATUS_DISPLAY[realtimeStatus];

  return (
    <>
      {/* Scrim behind the off-canvas sidebar on mobile. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-background/70 backdrop-blur-sm transition-opacity md:hidden",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        data-testid="app-sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-border bg-card/70 backdrop-blur-xl transition-transform duration-200 ease-out",
          "md:sticky md:top-0 md:z-0 md:h-screen md:translate-x-0 md:backdrop-blur-none",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary font-display text-sm font-extrabold text-primary-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.35),0_8px_18px_-6px_hsl(var(--primary)/0.65)]">
            S
          </span>
          <span className="font-display text-lg font-extrabold tracking-tight text-foreground">
            SyncHub
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="ml-auto grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV_ITEMS.map(({ to, label, icon: Icon, exact }) => (
            <Link
              key={to}
              to={to}
              onClick={onClose}
              activeOptions={{ exact }}
              className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[status=active]:bg-primary/10 data-[status=active]:text-foreground"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground group-data-[status=active]:text-primary" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="shrink-0 border-t border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <PresenceDot online={online} pulse={pulse} tone={tone} />
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Sync service
            </span>
          </div>
          <p className="mt-1 pl-4 text-xs font-medium text-foreground/80">{label}</p>
        </div>
      </aside>
    </>
  );
}
