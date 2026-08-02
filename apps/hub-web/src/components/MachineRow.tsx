import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PublicMachine } from "@synchub/shared";
import { Trash2 } from "lucide-react";
import { deleteMachine } from "@/lib/endpoints";
import { qk } from "@/lib/query-keys";
import { ApiError } from "@/lib/api-error";
import { usePresence } from "@/realtime/presence-store";
import { PresenceDot } from "@/components/PresenceDot";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
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

interface MachineRowProps {
  machine: PublicMachine;
}

/**
 * One row in the machines table. Presence is driven by `usePresence` — the
 * realtime store, seeded on WS connect from the backend's presence snapshot
 * and kept live by `presence` WS frames — falling back to the machine's own
 * `status` from the API for the instant before that snapshot lands. This is
 * what makes the dot (and the "Online"/"Offline" label next to it) update
 * without a refetch — the §7.1 fix, visualized.
 */
export function MachineRow({ machine }: MachineRowProps) {
  const queryClient = useQueryClient();
  const live = usePresence(machine.id);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const online = (live?.status ?? machine.status) === "online";
  const lastSeenAt = live?.lastSeenAt ?? machine.last_seen_at;

  const deleteMutation = useMutation({
    mutationFn: () => deleteMachine(machine.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.machines });
      queryClient.invalidateQueries({ queryKey: qk.dashboardMetrics });
      toast.success("Machine removed");
      setConfirmOpen(false);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove machine. Please try again.");
    },
  });

  return (
    <>
      <TableRow>
        <TableCell>
          <div className="font-medium text-foreground">{machine.name}</div>
          {machine.label && <div className="text-xs text-muted-foreground">{machine.label}</div>}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {machine.os ? (
            <span>
              {machine.os}
              {machine.os_version ? ` ${machine.os_version}` : ""}
            </span>
          ) : (
            "—"
          )}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <PresenceDot online={online} pulse={online} />
            <span className={cn("text-xs font-medium", online ? "text-success" : "text-muted-foreground")}>
              {online ? "Online" : "Offline"}
            </span>
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">{lastSeenAt ? timeAgo(lastSeenAt) : "—"}</TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground">{machine.last_ip ?? "—"}</TableCell>
        <TableCell className="text-muted-foreground">{machine.agent_version ?? "—"}</TableCell>
        <TableCell className="text-right">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            aria-label={`Delete ${machine.name}`}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </TableCell>
      </TableRow>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{machine.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This disconnects the machine from SyncHub and revokes its token. Files already synced to
              it are left untouched. This can&rsquo;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate();
              }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
