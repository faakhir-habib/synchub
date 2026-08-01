// Stub screens for sidebar destinations that later Phase 3 tasks flesh out
// (3b/3c bring the real Projects/Machines/Conflicts/Notifications/Settings
// screens). They exist now so the persistent shell has real navigation
// targets instead of dead links. The Dashboard (3a-6) is the one screen
// that's real already — see routes/Dashboard.tsx.
function PlaceholderPage({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
      <p className="max-w-prose text-sm text-muted-foreground">{blurb}</p>
      <div className="mt-4 flex h-40 items-center justify-center rounded-xl border border-dashed border-border bg-card/40 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Coming soon
      </div>
    </div>
  );
}

export function Projects() {
  return (
    <PlaceholderPage
      title="Projects"
      blurb="Every synced project, its machines, and its sync mode — create, configure, and manage from here."
    />
  );
}

export function Machines() {
  return (
    <PlaceholderPage
      title="Machines"
      blurb="Every machine synced to your projects, and whether it's currently reachable."
    />
  );
}

export function Conflicts() {
  return (
    <PlaceholderPage
      title="Conflicts"
      blurb="Sync conflicts across your projects, ready to review and resolve."
    />
  );
}

export function Notifications() {
  return (
    <PlaceholderPage
      title="Notifications"
      blurb="Sync activity, conflict alerts, and machine status changes."
    />
  );
}

export function Settings() {
  return (
    <PlaceholderPage
      title="Settings"
      blurb="Account details, notification preferences, and integrations."
    />
  );
}
