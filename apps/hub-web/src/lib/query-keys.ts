export const qk = {
  me: ["me"] as const,
  dashboardMetrics: ["dashboard", "metrics"] as const,
  activity: ["dashboard", "activity"] as const,
  projects: ["projects"] as const,
  project: (id: number) => ["projects", id] as const,
  projectConflicts: (id: number) => ["projects", id, "conflicts"] as const,
  machines: ["machines"] as const,
  conflicts: ["conflicts"] as const,
  notifications: ["notifications"] as const,
};
