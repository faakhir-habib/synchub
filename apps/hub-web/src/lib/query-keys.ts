export const qk = {
  me: ["me"] as const,
  dashboardMetrics: ["dashboard", "metrics"] as const,
  activity: ["dashboard", "activity"] as const,
  projects: ["projects"] as const,
  project: (id: number) => ["projects", id] as const,
  projectConflicts: (id: number) => ["projects", id, "conflicts"] as const,
  // Deliberately NOT nested under ["projects", id, "conflicts", ...] —
  // TanStack Query's invalidateQueries does prefix matching by default, so
  // nesting this under projectConflicts's key would mean invalidating the
  // conflicts LIST (e.g. after every resolve) also force-refetches this
  // still-mounted query while its dialog is closing, hitting the content
  // endpoint's "conflict not open" 404 for the conflict that was just
  // resolved. A flat, sibling key keeps the two invalidation-independent.
  conflictContent: (projectId: number, conflictId: number) =>
    ["conflictContent", projectId, conflictId] as const,
  machines: ["machines"] as const,
  conflicts: ["conflicts"] as const,
  notifications: ["notifications"] as const,
};
