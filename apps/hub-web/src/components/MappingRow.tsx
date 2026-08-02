import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { removeMapping } from "@/lib/endpoints";
import { qk } from "@/lib/query-keys";
import { ApiError } from "@/lib/api-error";
import { usePresence } from "@/realtime/presence-store";
import { PresenceDot } from "@/components/PresenceDot";
import { AddMappingDialog } from "@/components/AddMappingDialog";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface MappingRowMapping {
  machine_id: number;
  local_path: string;
  alias: string | null;
}

interface MappingRowProps {
  mapping: MappingRowMapping;
  projectId: number;
  /** All machine ids currently mapped to this project — forwarded to the edit dialog for filtering. */
  existingMachineIds: number[];
}

/**
 * One row in the project detail's mappings table — the machine's live
 * presence + local path, plus edit/remove actions. Presence is driven by
 * `usePresence` (the realtime store), not by the project query, so the dot
 * updates the instant a `presence` WS frame arrives.
 */
export function MappingRow({ mapping, projectId, existingMachineIds }: MappingRowProps) {
  const queryClient = useQueryClient();
  const presence = usePresence(mapping.machine_id);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const removeMutation = useMutation({
    mutationFn: () => removeMapping(projectId, mapping.machine_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
      toast.success("Mapping removed");
      setConfirmOpen(false);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove mapping. Please try again.");
    },
  });

  const label = mapping.alias ?? `Machine #${mapping.machine_id}`;

  return (
    <>
      <TableRow>
        <TableCell>
          <div className="flex items-center gap-2">
            <PresenceDot online={presence?.status === "online"} />
            <span className="font-medium text-foreground">{label}</span>
          </div>
        </TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground">{mapping.local_path}</TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`Edit mapping for ${label}`}
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              aria-label={`Remove mapping for ${label}`}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      <AddMappingDialog
        projectId={projectId}
        existingMachineIds={existingMachineIds}
        open={editOpen}
        onOpenChange={setEditOpen}
        editingMapping={mapping}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove &ldquo;{label}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops syncing this project to that machine. Files already on disk are left untouched.
              This can&rsquo;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                removeMutation.mutate();
              }}
            >
              {removeMutation.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
