import { cn } from "@/lib/utils";

export interface PresenceDotProps {
  /** Online/reachable vs offline/unknown. */
  online?: boolean;
  /** Adds a soft radar-ping animation — reserve for "actively watched" states. */
  pulse?: boolean;
  className?: string;
  "aria-hidden"?: boolean;
}

/**
 * Small colored status dot — green when online, muted when offline.
 * Reused by the sidebar's "Sync service" indicator and, later, the
 * machines list (Phase 3a/3c).
 */
export function PresenceDot({ online = false, pulse = false, className, ...rest }: PresenceDotProps) {
  return (
    <span className={cn("relative inline-flex h-2 w-2 shrink-0", className)} {...rest}>
      {pulse && online && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
      )}
      <span
        className={cn(
          "relative inline-flex h-2 w-2 rounded-full",
          online ? "bg-success" : "bg-muted-foreground/40",
        )}
      />
    </span>
  );
}
