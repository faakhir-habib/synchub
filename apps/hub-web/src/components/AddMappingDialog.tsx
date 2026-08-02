import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getMachines, upsertMapping } from "@/lib/endpoints";
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

export interface MappingEditTarget {
  machine_id: number;
  local_path: string;
  alias: string | null;
}

interface AddMappingDialogProps {
  projectId: number;
  /** Machine ids already mapped to this project — filtered out of the "add" list. */
  existingMachineIds: number[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this mapping instead of creating one — the machine select is prefilled and locked. */
  editingMapping?: MappingEditTarget | null;
}

/**
 * Controlled "map this project to a machine" dialog, reused for both
 * creating a new mapping (from the mappings section's header button) and
 * editing an existing one (from MappingRow) — `editingMapping` switches the
 * mode, disabling the machine select and prefilling both fields.
 */
export function AddMappingDialog({
  projectId,
  existingMachineIds,
  open,
  onOpenChange,
  editingMapping = null,
}: AddMappingDialogProps) {
  const queryClient = useQueryClient();
  // Only fetch once the dialog is actually open — no point paying for the
  // machines list while it's closed.
  const machines = useQuery({ queryKey: qk.machines, queryFn: getMachines, enabled: open });

  const isEditing = editingMapping !== null;

  const [machineId, setMachineId] = useState<string>("");
  const [localPath, setLocalPath] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMachineId(editingMapping ? String(editingMapping.machine_id) : "");
      setLocalPath(editingMapping?.local_path ?? "");
      setFieldError(null);
      setFormError(null);
    }
  }, [open, editingMapping]);

  const mutation = useMutation({
    mutationFn: ({ machineId: mid, local_path }: { machineId: number; local_path: string }) =>
      upsertMapping(projectId, mid, { local_path }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
      toast.success(isEditing ? "Mapping updated" : "Machine mapped");
      onOpenChange(false);
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    },
  });

  const availableMachines = (machines.data ?? []).filter((m) =>
    isEditing ? m.id === editingMapping!.machine_id : !existingMachineIds.includes(m.id),
  );

  function handleOpenChange(next: boolean) {
    if (!next) mutation.reset();
    onOpenChange(next);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!machineId) {
      setFieldError("Choose a machine.");
      return;
    }
    if (!localPath.trim()) {
      setFieldError("Enter a folder path.");
      return;
    }
    setFieldError(null);
    mutation.mutate({ machineId: Number(machineId), local_path: localPath });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit mapping" : "Add mapping"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update the local folder this machine syncs to."
                : "Map this project to a folder on one of your machines."}
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
              <Label htmlFor="mapping-machine">Machine</Label>
              <Select value={machineId} onValueChange={setMachineId} disabled={isEditing}>
                <SelectTrigger id="mapping-machine">
                  <SelectValue placeholder="Choose a machine" />
                </SelectTrigger>
                <SelectContent>
                  {availableMachines.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.label ?? m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mapping-path">Local folder path</Label>
              <Input
                id="mapping-path"
                autoComplete="off"
                value={localPath}
                onChange={(e) => {
                  setLocalPath(e.target.value);
                  if (fieldError) setFieldError(null);
                }}
                placeholder="e.g. C:\Users\me\dotfiles"
                className="font-mono"
                aria-invalid={fieldError ? true : undefined}
              />
              {fieldError && <p className="text-xs text-destructive">{fieldError}</p>}
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : isEditing ? "Save changes" : "Add mapping"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
