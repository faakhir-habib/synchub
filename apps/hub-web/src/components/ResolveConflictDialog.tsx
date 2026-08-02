import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownToLine, ShieldCheck } from "lucide-react";
import { resolveConflict, type ConflictWithProjectAlias } from "@/lib/endpoints";
import { qk } from "@/lib/query-keys";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type Choice = "candidate" | "canonical";

interface ResolveConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The conflict being resolved. Only read while `open`; may lag a tick
   * behind `open` flipping to false during the close animation. */
  conflict: ConflictWithProjectAlias | null;
}

/**
 * Controlled dialog for resolving a single open conflict. Rather than a
 * select-then-confirm flow, each side of the conflict is its own large,
 * clearly-labeled action button — clicking one *is* the confirmation, which
 * keeps a two-choice decision to a single deliberate click instead of two.
 * The "can't be undone" note stays visible the whole time so that click
 * carries the right weight.
 */
export function ResolveConflictDialog({ open, onOpenChange, conflict }: ResolveConflictDialogProps) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (choice: Choice) => {
      if (!conflict) return Promise.reject(new Error("no conflict selected"));
      return resolveConflict(conflict.project_id, conflict.id, { choice });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: qk.conflicts });
      if (conflict) {
        queryClient.invalidateQueries({ queryKey: qk.projectConflicts(conflict.project_id) });
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
      mutation.reset();
    }
    onOpenChange(next);
  }

  if (!conflict) return null;

  const pendingChoice = mutation.isPending ? mutation.variables : undefined;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve conflict</DialogTitle>
          <DialogDescription>
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em] text-foreground">
              {conflict.filename}
            </code>{" "}
            in <span className="font-medium text-foreground">{conflict.project_alias}</span> diverged
            and needs manual resolution.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          {formError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </div>
          )}

          <ChoiceButton
            icon={<ArrowDownToLine className="h-4 w-4" />}
            title="Keep the incoming version"
            description="The version pushed from the machine that caused the conflict."
            pending={pendingChoice === "candidate"}
            disabled={mutation.isPending}
            onClick={() => {
              setFormError(null);
              mutation.mutate("candidate");
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
              mutation.mutate("canonical");
            }}
          />

          <p className="pt-1 text-center text-xs text-muted-foreground">This can&rsquo;t be undone.</p>
        </div>

        <DialogFooter className="mt-4">
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
