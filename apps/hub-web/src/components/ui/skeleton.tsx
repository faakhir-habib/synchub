import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Loading placeholder — a softly pulsing block matching the shape of the
 * content it stands in for. Used anywhere a query is `isPending`, so first
 * paint never flashes a bare "—" before real data arrives.
 */
function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-testid="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
