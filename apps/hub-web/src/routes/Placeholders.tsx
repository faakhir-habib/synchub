// Stub screen for the one remaining sidebar destination a later Phase 3 task
// flushes out (3c brings the real Settings screen). It exists now so the
// persistent shell has a real navigation target instead of a dead link.
// Dashboard (3a-6), Projects/ProjectDetail (3b-2/3b-3), Machines (3b-4),
// Conflicts (3c-1), and Notifications (3c-2) are real already — see
// routes/Dashboard.tsx, routes/Projects.tsx, routes/ProjectDetail.tsx,
// routes/Machines.tsx, routes/Conflicts.tsx, routes/Notifications.tsx.
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

export function Settings() {
  return (
    <PlaceholderPage
      title="Settings"
      blurb="Account details, notification preferences, and integrations."
    />
  );
}
