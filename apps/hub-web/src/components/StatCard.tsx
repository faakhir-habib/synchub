import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type StatAccent = "primary" | "info" | "warning" | "success" | "destructive";

const BADGE_STYLES: Record<StatAccent, string> = {
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  warning: "bg-warning/10 text-warning",
  success: "bg-success/10 text-success",
  destructive: "bg-destructive/10 text-destructive",
};

const GLOW_STYLES: Record<StatAccent, string> = {
  primary: "bg-primary/25",
  info: "bg-info/25",
  warning: "bg-warning/25",
  success: "bg-success/25",
  destructive: "bg-destructive/25",
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
}: StatCardProps) {
  return (
    <Card
      className={cn(
        "relative overflow-hidden p-5 transition-colors duration-200 hover:border-border/70",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full blur-3xl",
          GLOW_STYLES[accent],
        )}
      />
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          {isLoading ? (
            <Skeleton className="mt-2.5 h-8 w-16" />
          ) : (
            <p className="mt-1 font-display text-3xl font-bold tabular-nums leading-none tracking-tight text-foreground">
              {value}
            </p>
          )}
        </div>
        <span
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
            BADGE_STYLES[accent],
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>
      </div>
      <div className="relative mt-3 min-h-[1rem]">
        {isLoading ? (
          <Skeleton className="h-3.5 w-24" />
        ) : hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    </Card>
  );
}
