import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Laptop, Plus } from "lucide-react";
import { getMachines } from "@/lib/endpoints";
import { qk } from "@/lib/query-keys";
import { ErrorPanel } from "@/components/ErrorPanel";
import { CreateMachineDialog } from "@/components/CreateMachineDialog";
import { MachineRow } from "@/components/MachineRow";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function MachinesTableSkeleton() {
  return (
    <TableBody>
      {Array.from({ length: 4 }).map((_, i) => (
        <TableRow key={i}>
          <TableCell>
            <Skeleton className="h-4 w-28" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-24" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-16" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-20" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-24" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-16" />
          </TableCell>
          <TableCell className="text-right">
            <Skeleton className="ml-auto h-8 w-8 rounded-md" />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}

function EmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/40 py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
        <Laptop className="h-6 w-6" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">No machines connected</p>
        <p className="max-w-[24rem] text-sm text-muted-foreground">
          Connect a machine, then map a project to a folder on it to start syncing.
        </p>
      </div>
      <Button onClick={onConnect} className="mt-1">
        <Plus className="h-4 w-4" />
        Connect machine
      </Button>
    </div>
  );
}

/**
 * Machines screen — every machine on the account, its live presence, and
 * connect/delete actions. Presence comes from the realtime store
 * (`usePresence`, seeded on WS connect from the backend's snapshot and kept
 * live by `presence` frames) via `MachineRow`, not from this query, so the
 * dots update without a refetch. `qk.machines` itself only needs a refetch
 * for structural changes — a machine being added or removed — which is what
 * the create/delete mutations invalidate.
 */
export function Machines() {
  const machines = useQuery({ queryKey: qk.machines, queryFn: getMachines });
  const [createOpen, setCreateOpen] = useState(false);

  const list = machines.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Machines
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every machine synced to your projects, and whether it&rsquo;s currently reachable.
          </p>
        </div>
        {/* Direct-create only for now. Task 5 adds a pairing-code flow
            alongside this — likely a "Pair a machine" option off this same
            button — without changing what CreateMachineDialog owns. */}
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Connect machine
        </Button>
      </header>

      {machines.isError ? (
        <ErrorPanel error={machines.error} />
      ) : machines.isPending ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Machine</TableHead>
                <TableHead>OS</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Last IP</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <MachinesTableSkeleton />
          </Table>
        </div>
      ) : list.length === 0 ? (
        <EmptyState onConnect={() => setCreateOpen(true)} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Machine</TableHead>
                <TableHead>OS</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Last IP</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((machine) => (
                <MachineRow key={machine.id} machine={machine} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateMachineDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
