import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownToLine, PencilLine, ShieldCheck } from "lucide-react";
import {
  getConflictContent,
  resolveConflict,
  type ConflictWithProjectAlias,
} from "@/lib/endpoints";
import { qk } from "@/lib/query-keys";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConflictDiffView } from "@/components/ConflictDiffView";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type Choice = "candidate" | "canonical" | "manual";

interface ResolveConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The conflict being resolved. Only read while `open`; may lag a tick
   * behind `open` flipping to false during the close animation. */
  conflict: ConflictWithProjectAlias | null;
}

/** Same rule the server enforces (ConflictsService.assertValidJsonl) — checked
 * here too so a bad edit gets an inline error instead of a round-trip. */
function findInvalidJsonlLine(content: string): number | null {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    try {
      JSON.parse(lines[i]);
    } catch {
      return i + 1;
    }
  }
  return null;
}

/**
 * Controlled dialog for resolving a single open conflict — git-style: shows
 * a line-level diff of both versions, offers one-click "keep this side"
 * actions, and an editable box for a hand-merged result.
 */
export function ResolveConflictDialog({ open, onOpenChange, conflict }: ResolveConflictDialogProps) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [manualContent, setManualContent] = useState("");
  const [manualTouched, setManualTouched] = useState(false);

  const content = useQuery({
    queryKey: conflict
      ? qk.conflictContent(conflict.project_id, conflict.id)
      : (["conflict-content", "none"] as const),
    queryFn: () => {
      if (!conflict) return Promise.reject(new Error("no conflict selected"));
      return getConflictContent(conflict.project_id, conflict.id);
    },
    enabled: open && conflict !== null,
  });

  // Seed the editable box with the canonical version once content loads,
  // but only until the user actually types in it — a background refetch
  // must not clobber an in-progress manual edit.
  useEffect(() => {
    if (content.data && !manualTouched) {
      setManualContent(content.data.canonical);
    }
  }, [content.data, manualTouched]);

  const mutation = useMutation({
    mutationFn: (payload: { choice: Choice; content?: string }) => {
      if (!conflict) return Promise.reject(new Error("no conflict selected"));
      return resolveConflict(conflict.project_id, conflict.id, payload);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: qk.conflicts });
      if (conflict) {
        queryClient.invalidateQueries({ queryKey: qk.projectConflicts(conflict.project_id) });
        // Deliberately NOT touching qk.conflictContent here: both
        // invalidateQueries and removeQueries force an immediate refetch on
        // a query that still has an active, enabled observer (this dialog's
        // own useQuery is still mounted at this exact point — `open` hasn't
        // flipped to false yet, that happens below), and that refetch would
        // just hit the content endpoint's "conflict not open" 404 (it only
        // serves open conflicts). The conflict's content is write-once and
        // never needs to be re-fetched post-resolution — once this dialog
        // unmounts (closing now), React Query's default GC drops the unused
        // cache entry on its own; nothing to do here.
      }
      queryClient.invalidateQueries({ queryKey: qk.dashboardMetrics });
      toast.success(`Conflict resolved — kept the ${result.choice} version`);
      handleOpenChange(false);
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    },
  });

  function handleOpenChange(next: boolean) {
    if (!next) {
      setFormError(null);
      setManualContent("");
      setManualTouched(false);
      mutation.reset();
    }
    onOpenChange(next);
  }

  function handleSaveManual() {
    const badLine = findInvalidJsonlLine(manualContent);
    if (badLine !== null) {
      setFormError(`Invalid JSON on line ${badLine} — each line must be a complete JSON object.`);
      return;
    }
    setFormError(null);
    mutation.mutate({ choice: "manual", content: manualContent });
  }

  if (!conflict) return null;

  const pendingChoice = mutation.isPending ? mutation.variables?.choice : undefined;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Resolve conflict</DialogTitle>
          <DialogDescription>
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em] text-foreground">
              {conflict.filename}
            </code>{" "}
            in <span className="font-medium text-foreground">{conflict.project_alias}</span> diverged
            and needs your decision.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {formError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </div>
          )}

          {content.isPending ? (
            <p className="text-sm text-muted-foreground">Loading both versions…</p>
          ) : content.isError ? (
            <p className="text-sm text-destructive">Couldn&rsquo;t load the conflicting content.</p>
          ) : (
            <ConflictDiffView canonical={content.data.canonical} candidate={content.data.candidate} />
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <ChoiceButton
              icon={<ArrowDownToLine className="h-4 w-4" />}
              title="Keep the incoming version"
              description="The version pushed from the machine that caused the conflict."
              pending={pendingChoice === "candidate"}
              disabled={mutation.isPending}
              onClick={() => {
                setFormError(null);
                mutation.mutate({ choice: "candidate" });
              }}
            />
            <ChoiceButton
              icon={<ShieldCheck className="h-4 w-4" />}
              title="Keep the current synced version"
              description="What's currently in sync across your other machines."
              pending={pendingChoice === "canonical"}
              disabled={mutation.isPending}
              onClick={() => {
                setFormError(null);
                mutation.mutate({ choice: "canonical" });
              }}
            />
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <PencilLine className="h-4 w-4" />
                Or merge it yourself
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!content.data}
                  onClick={() => {
                    if (content.data) {
                      setManualContent(content.data.canonical);
                      setManualTouched(true);
                    }
                  }}
                >
                  Fill from current
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!content.data}
                  onClick={() => {
                    if (content.data) {
                      setManualContent(content.data.candidate);
                      setManualTouched(true);
                    }
                  }}
                >
                  Fill from incoming
                </Button>
              </div>
            </div>
            <Textarea
              value={manualContent}
              onChange={(e) => {
                setManualContent(e.target.value);
                setManualTouched(true);
              }}
              disabled={!content.data || mutation.isPending}
              rows={8}
              className="font-mono text-xs"
              placeholder="Edit the merged JSONL content here…"
              aria-label="Merged resolution content"
            />
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={!content.data || mutation.isPending}
                onClick={handleSaveManual}
              >
                {pendingChoice === "manual" ? "Saving…" : "Save merged version"}
              </Button>
            </div>
          </div>

          <p className="text-center text-xs text-muted-foreground">This can&rsquo;t be undone.</p>
        </div>

        <DialogFooter className="mt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChoiceButton({
  icon,
  title,
  description,
  pending,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors",
        "hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-60",
      )}
    >
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {pending ? "Resolving…" : title}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
