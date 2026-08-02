import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@synchub/shared";
import { FolderKanban, MoreHorizontal, Plus, ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getProjects, deleteProject } from "@/lib/endpoints";
import { qk } from "@/lib/query-keys";
import { ApiError } from "@/lib/api-error";
import { timeAgo } from "@/lib/format";
import { ErrorPanel } from "@/components/ErrorPanel";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const SYNC_MODE_DISPLAY: Record<Project["sync_mode"], { label: string; badgeVariant: "success" | "secondary" | "outline" }> = {
  auto: { label: "Auto", badgeVariant: "success" },
  manual: { label: "Manual", badgeVariant: "secondary" },
  stopped: { label: "Stopped", badgeVariant: "outline" },
};

function ProjectsTableSkeleton() {
  return (
    <TableBody>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          <TableCell>
            <Skeleton className="h-4 w-32" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-16 rounded-md" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-20" />
          </TableCell>
          <TableCell className="text-right">
            <Skeleton className="ml-auto h-8 w-8 rounded-md" />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/40 py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
        <FolderKanban className="h-6 w-6" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">No projects yet</p>
        <p className="max-w-[24rem] text-sm text-muted-foreground">
          Create a project, then map it to a folder on each machine you want it synced to.
        </p>
      </div>
      <Button onClick={onCreate} className="mt-1">
        <Plus className="h-4 w-4" />
        New project
      </Button>
    </div>
  );
}

interface ProjectRowProps {
  project: Project;
  onDelete: (project: Project) => void;
}

function ProjectRow({ project, onDelete }: ProjectRowProps) {
  const navigate = useNavigate();
  const { label, badgeVariant } = SYNC_MODE_DISPLAY[project.sync_mode];

  return (
    <TableRow>
      <TableCell>
        <Link
          to="/projects/$id"
          params={{ id: String(project.id) }}
          className="font-medium text-foreground hover:text-primary hover:underline"
        >
          {project.alias}
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant={badgeVariant}>{label}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{timeAgo(project.created_at)}</TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open row actions" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => navigate({ to: "/projects/$id", params: { id: String(project.id) } })}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onDelete(project)}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

export function Projects() {
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: qk.projects, queryFn: getProjects });

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.projects });
      queryClient.invalidateQueries({ queryKey: qk.dashboardMetrics });
      toast.success("Project deleted");
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete project. Please try again.");
    },
  });

  const list = projects.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Projects
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every synced project, its machines, and its sync mode.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </header>

      {projects.isError ? (
        <ErrorPanel error={projects.error} />
      ) : projects.isPending ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alias</TableHead>
                <TableHead>Sync mode</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <ProjectsTableSkeleton />
          </Table>
        </div>
      ) : list.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alias</TableHead>
                <TableHead>Sync mode</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((project) => (
                <ProjectRow key={project.id} project={project} onDelete={setDeleteTarget} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{deleteTarget?.alias}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the project and its machine mappings from SyncHub. Files already synced to
              your machines are left untouched. This can&rsquo;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
