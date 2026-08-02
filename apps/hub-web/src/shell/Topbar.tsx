import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bell, Menu, Moon, Sun, LogOut, Settings as SettingsIcon, ChevronDown } from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { useTheme, type Theme } from "@/theme/theme-provider";
import { getNotifications } from "@/lib/endpoints";
import { qk } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TopbarProps {
  onMenuClick: () => void;
}

function resolveIsDark(theme: Theme): boolean {
  if (theme === "system") {
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return theme === "dark";
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  // staleTime keeps this from refetching on every focus/mount across the
  // shell — the count still stays live because RealtimeProvider invalidates
  // qk.notifications on every WS `notification` frame, which bypasses
  // staleTime and refetches immediately.
  const { data: notifs } = useQuery({
    queryKey: qk.notifications,
    queryFn: getNotifications,
    staleTime: 30_000,
  });

  const displayName = user?.name || user?.email || "Account";
  const initial = displayName.trim().charAt(0).toUpperCase() || "?";
  const isDark = resolveIsDark(theme);
  const unread = notifs?.unread ?? 0;
  const unreadLabel = unread > 9 ? "9+" : String(unread);

  async function handleLogout() {
    await logout();
    navigate({ to: "/login" });
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-1.5 border-b border-border bg-background/85 px-4 backdrop-blur-xl sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open menu"
        onClick={onMenuClick}
        className="md:hidden"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="flex-1" />

      <Button
        variant="ghost"
        size="icon"
        aria-label="Notifications"
        className="relative"
        onClick={() => navigate({ to: "/notifications" })}
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[1rem] place-items-center rounded-full bg-destructive px-1 font-mono text-[10px] font-bold leading-none text-destructive-foreground ring-2 ring-background">
            {unreadLabel}
          </span>
        )}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        aria-label="Toggle theme"
        onClick={() => setTheme(isDark ? "light" : "dark")}
      >
        {isDark ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="ml-1 flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
              {initial}
            </span>
            <span className="hidden max-w-[10rem] truncate sm:inline">{displayName}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
            {user?.email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
            <SettingsIcon className="mr-2 h-4 w-4" />
            Profile &amp; settings
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
