import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ProjectCreateRequest, type SyncMode } from "@synchub/shared";
import { createProject } from "@/lib/endpoints";
import { qk } from "@/lib/query-keys";
import { ApiError } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SYNC_MODE_OPTIONS: { value: SyncMode; label: string }[] = [
  { value: "auto", label: "Auto — sync continuously" },
  { value: "manual", label: "Manual — sync on demand" },
  { value: "stopped", label: "Stopped — paused" },
];

/**
 * Controlled "create project" dialog — open state lives in the parent
 * (Projects.tsx), reused for both the header button and the empty-state CTA.
 */
export function CreateProjectDialog({ open, onOpenChange }: CreateProjectDialogProps) {
  const queryClient = useQueryClient();
  const [alias, setAlias] = useState("");
  const [syncMode, setSyncMode] = useState<SyncMode>("auto");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      // Realtime only ever invalidates the single-project cache entry
      // (qk.project(id)); the list and dashboard tiles need an explicit
      // nudge whenever a project is created.
      queryClient.invalidateQueries({ queryKey: qk.projects });
      queryClient.invalidateQueries({ queryKey: qk.dashboardMetrics });
      toast.success("Project created");
      closeAndReset();
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    },
  });

  function reset() {
    setAlias("");
    setSyncMode("auto");
    setFieldError(null);
    setFormError(null);
    mutation.reset();
  }

  function closeAndReset() {
    reset();
    onOpenChange(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsed = ProjectCreateRequest.safeParse({ alias, sync_mode: syncMode });
    if (!parsed.success) {
      setFieldError("Enter a project alias.");
      return;
    }
    setFieldError(null);
    mutation.mutate(parsed.data);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Give it a short, memorable alias — you&rsquo;ll map it to folders on each machine next.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-4">
            {formError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {formError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="project-alias">Alias</Label>
              <Input
                id="project-alias"
                autoFocus
                autoComplete="off"
                value={alias}
                onChange={(e) => {
                  setAlias(e.target.value);
                  if (fieldError) setFieldError(null);
                }}
                placeholder="e.g. dotfiles"
                aria-invalid={fieldError ? true : undefined}
              />
              {fieldError && <p className="text-xs text-destructive">{fieldError}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="project-sync-mode">Sync mode</Label>
              <Select value={syncMode} onValueChange={(v) => setSyncMode(v as SyncMode)}>
                <SelectTrigger id="project-sync-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SYNC_MODE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
