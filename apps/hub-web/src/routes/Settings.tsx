import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogOut, Monitor, Moon, ShieldAlert, Sun } from "lucide-react";
import type { MeResponse, ProfileUpdateRequest } from "@synchub/shared";
import { getMe, updateMe } from "@/lib/endpoints";
import { qk } from "@/lib/query-keys";
import { useAuth } from "@/auth/auth-context";
import { useTheme, type Theme } from "@/theme/theme-provider";
import { ApiError } from "@/lib/api-error";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface FormState {
  name: string;
  webhookUrl: string;
  notifyConflicts: boolean;
  notifySync: boolean;
}

function toForm(me: MeResponse): FormState {
  return {
    name: me.name ?? "",
    webhookUrl: me.notify_webhook_url ?? "",
    notifyConflicts: me.notify_conflicts,
    notifySync: me.notify_sync,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-6">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-2 h-3.5 w-64" />
          <div className="mt-6 space-y-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * Settings screen — profile (name, notification webhook + toggles),
 * appearance (theme), and account (email + log out). `qk.me` backs the
 * profile form; `useAuth().user` is a *separate* piece of state that the
 * topbar's user chip reads, so a successful save both invalidates `qk.me`
 * and awaits `refreshUser()` to keep the two in sync without a reload.
 */
export function Settings() {
  const me = useQuery({ queryKey: qk.me, queryFn: getMe });
  const queryClient = useQueryClient();
  const { logout, refreshUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seeds the editable form once, the first time getMe resolves. Later
  // background refetches (e.g. window refocus) intentionally don't clobber
  // in-progress edits — by the time a refetch follows a successful save, the
  // form already matches what was sent.
  useEffect(() => {
    if (me.data && form === null) {
      setForm(toForm(me.data));
    }
  }, [me.data, form]);

  const mutation = useMutation({
    mutationFn: (body: ProfileUpdateRequest) => updateMe(body),
    onSuccess: async () => {
      setSaveError(null);
      queryClient.invalidateQueries({ queryKey: qk.me });
      await refreshUser();
      toast.success("Profile updated");
    },
    onError: (err) => {
      setSaveError(errorMessage(err));
    },
  });

  if (me.isPending) {
    return <SettingsSkeleton />;
  }

  if (me.isError) {
    return <ErrorPanel error={me.error} />;
  }

  const original = toForm(me.data);
  const current = form ?? original;
  const dirty =
    current.name !== original.name ||
    current.webhookUrl !== original.webhookUrl ||
    current.notifyConflicts !== original.notifyConflicts ||
    current.notifySync !== original.notifySync;

  function update(patch: Partial<FormState>) {
    setForm({ ...current, ...patch });
    if (saveError) setSaveError(null);
  }

  function handleSave() {
    mutation.mutate({
      name: current.name.trim() === "" ? null : current.name.trim(),
      notify_webhook_url: current.webhookUrl.trim() === "" ? null : current.webhookUrl.trim(),
      notify_conflicts: current.notifyConflicts,
      notify_sync: current.notifySync,
    });
  }

  async function handleLogout() {
    await logout();
    navigate({ to: "/login" });
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your profile, notifications, and how SyncHub looks.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Profile</CardTitle>
          <CardDescription>Your name and where sync notifications get sent.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {saveError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="settings-name">Name</Label>
            <Input
              id="settings-name"
              autoComplete="name"
              value={current.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="Your name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="settings-webhook">Notification webhook URL</Label>
            <Input
              id="settings-webhook"
              autoComplete="off"
              inputMode="url"
              value={current.webhookUrl}
              onChange={(e) => update({ webhookUrl: e.target.value })}
              placeholder="https://example.com/hooks/synchub"
            />
            <p className="text-xs text-muted-foreground">
              SyncHub POSTs notifications here &mdash; must be a public http/https URL. Private or
              localhost URLs are silently skipped when we send notifications; the SSRF guard blocks
              them at send time.
            </p>
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="settings-notify-conflicts">Notify on conflicts</Label>
                <p className="text-xs text-muted-foreground">
                  Get notified when a sync produces a conflict that needs your decision.
                </p>
              </div>
              <Switch
                id="settings-notify-conflicts"
                checked={current.notifyConflicts}
                onCheckedChange={(checked) => update({ notifyConflicts: checked })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="settings-notify-sync">Notify on syncs</Label>
                <p className="text-xs text-muted-foreground">
                  Get notified on ordinary, successful syncs too, not just conflicts.
                </p>
              </div>
              <Switch
                id="settings-notify-sync"
                checked={current.notifySync}
                onCheckedChange={(checked) => update({ notifySync: checked })}
              />
            </div>
          </div>

          <div className="flex justify-end border-t border-border pt-4">
            <Button onClick={handleSave} disabled={!dirty || mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Appearance</CardTitle>
          <CardDescription>How SyncHub looks on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            role="radiogroup"
            aria-label="Theme"
            className="inline-flex rounded-lg border border-border bg-muted/40 p-1"
          >
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                onClick={() => setTheme(value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  theme === value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Account</CardTitle>
          <CardDescription>Sign-in details for this account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="settings-email">Email</Label>
            <p id="settings-email" className="text-sm text-muted-foreground">
              {me.data.email}
            </p>
          </div>

          <div className="flex justify-end border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              Log out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
