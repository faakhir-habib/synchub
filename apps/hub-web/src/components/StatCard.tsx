import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type StatAccent = "primary" | "info" | "warning" | "success" | "destructive";

// Each accent maps to a design-token HSL triplet. We funnel it through a single
// local `--sc` custom property (set inline) so the signal dot, icon chip, glow,
// top-rule, ring and hover shadow all read from ONE source and stay perfectly
// in sync — change the accent and the whole tile re-tints coherently.
const ACCENT_VAR: Record<StatAccent, string> = {
  primary: "var(--primary)",
  info: "var(--info)",
  warning: "var(--warning)",
  success: "var(--success)",
  destructive: "var(--destructive)",
};

export interface StatCardProps {
  label: string;
  value?: ReactNode;
  icon: LucideIcon;
  hint?: string;
  accent?: StatAccent;
  /** Renders skeleton placeholders in place of value/hint — no "—" flash. */
  isLoading?: boolean;
  className?: string;
  /** Position in the grid — drives a subtle staggered entrance. */
  index?: number;
}

/** A single metric tile — the atomic unit of the dashboard's stat grid. */
export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  accent = "primary",
  isLoading = false,
  className,
  index = 0,
}: StatCardProps) {
  return (
    <Card
      style={{ "--sc": ACCENT_VAR[accent], animationDelay: `${index * 70}ms` } as CSSProperties}
      className={cn(
        "relative isolate animate-stat-in overflow-hidden border-border/60 p-5 shadow-none",
        // faint accent wash from the top-right corner — gives the surface depth
        // instead of flat white/slate.
        "bg-[radial-gradient(125%_125%_at_100%_0%,hsl(var(--sc)_/_0.08),transparent_55%)]",
        className,
      )}
    >
      {/* top accent rule — a static hairline gradient */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,hsl(var(--sc)_/_0.7),transparent)] opacity-50"
      />
      {/* corner glow — a soft, static accent halo */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 -top-8 -z-10 h-24 w-24 rounded-full bg-[hsl(var(--sc)_/_0.32)] blur-2xl"
      />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {label ? (
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--sc))] shadow-[0_0_6px_hsl(var(--sc)_/_0.8)]"
              />
            ) : null}
            {label}
          </p>
          {isLoading ? (
            <Skeleton className="mt-2.5 h-8 w-16" />
          ) : (
            <p className="mt-1.5 font-display text-3xl font-bold tabular-nums leading-none tracking-tight text-foreground">
              {value}
            </p>
          )}
        </div>
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,hsl(var(--sc)_/_0.2),hsl(var(--sc)_/_0.06))] text-[hsl(var(--sc))] ring-1 ring-inset ring-[hsl(var(--sc)_/_0.25)]"
        >
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>
      </div>

      <div className="mt-3 min-h-[1rem]">
        {isLoading ? (
          <Skeleton className="h-3.5 w-24" />
        ) : hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    </Card>
  );
}
