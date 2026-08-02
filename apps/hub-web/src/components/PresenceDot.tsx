import { cn } from "@/lib/utils";

export interface PresenceDotProps {
  /** Online/reachable vs offline/unknown. */
  online?: boolean;
  /** Adds a soft radar-ping animation — reserve for "actively watched" states. */
  pulse?: boolean;
  /**
   * Dot color. "success" (green, default) for a healthy online state,
   * "warning" (amber) for a transient/degraded-but-not-dead state (e.g. a
   * reconnecting websocket). Ignored when `online` is false — offline always
   * renders muted.
   */
  tone?: "success" | "warning";
  className?: string;
  "aria-hidden"?: boolean;
}

/**
 * Small colored status dot — green (or amber, via `tone`) when online, muted
 * when offline. Reused by the sidebar's "Sync service" indicator and, later,
 * the machines list (Phase 3a/3c).
 */
export function PresenceDot({
  online = false,
  pulse = false,
  tone = "success",
  className,
  ...rest
}: PresenceDotProps) {
  const toneClass = tone === "warning" ? "bg-warning" : "bg-success";
  return (
    <span className={cn("relative inline-flex h-2 w-2 shrink-0", className)} {...rest}>
      {pulse && online && (
        <span
          className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", toneClass)}
        />
      )}
      <span
        className={cn(
          "relative inline-flex h-2 w-2 rounded-full",
          online ? toneClass : "bg-muted-foreground/40",
        )}
      />
    </span>
  );
}
