import { GoneException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { RelayStoreService } from "../sync/relay-store.service.js";
import { NotifyService } from "../notify/notify.service.js";
import { REALTIME_PORT } from "../realtime/realtime.port.js";
import type { RealtimePort } from "../realtime/realtime.port.js";

// A conflict row plus the alias of the project it belongs to, for the
// cross-project "all my open conflicts" view.
export interface ConflictWithProjectAlias {
  id: number;
  project_id: number;
  filename: string;
  machine_id: number | null;
  candidate_hash: string;
  auto_merged: boolean;
  status: string;
  created_at: string;
  resolved_at: string | null;
  project_alias: string;
}

export type ResolveChoice = "candidate" | "canonical";

export interface ResolveResult {
  status: "resolved";
  choice: ResolveChoice;
}

// Ports legacy hub/src/models/conflicts.js#listOpenForUser + resolve, and the
// resolve handler from hub/src/routes/projects.js
// (POST /:id/conflicts/:conflictId/resolve). Deliberately does NOT inject
// ProjectsService — ownership is checked here with raw Prisma to avoid a
// circular Projects<->Conflicts module dependency.
@Injectable()
export class ConflictsService {
  private readonly logger = new Logger(ConflictsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly relayStore: RelayStoreService,
    private readonly notify: NotifyService,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
  ) {}

  async listOpenForUser(userId: number): Promise<ConflictWithProjectAlias[]> {
    const rows = await this.prisma.conflict.findMany({
      where: { status: "open", project: { user_id: userId } },
      include: { project: { select: { alias: true } } },
      orderBy: { created_at: "desc" },
    });

    return rows.map((c) => ({
      id: c.id,
      project_id: c.project_id,
      filename: c.filename,
      machine_id: c.machine_id,
      candidate_hash: c.candidate_hash,
      auto_merged: c.auto_merged !== 0,
      status: c.status,
      created_at: c.created_at.toISOString(),
      resolved_at: c.resolved_at ? c.resolved_at.toISOString() : null,
      project_alias: c.project.alias,
    }));
  }

  // Resolve an open conflict by keeping either the pushed "candidate" or the
  // existing "canonical" version. Ports hub/src/routes/projects.js's
  // `POST /:id/conflicts/:conflictId/resolve` handler exactly, with the
  // legacy `store.read/write` (name-derived flat files) replaced by the
  // content-addressed RelayStore keyed on the conflict's full candidate_hash.
  async resolve(
    userId: number,
    projectId: number,
    conflictId: number,
    rawChoice: unknown,
  ): Promise<ResolveResult> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, user_id: userId },
    });
    if (!project) {
      throw new NotFoundException({ error: "not found" });
    }

    const conflict = await this.prisma.conflict.findUnique({ where: { id: conflictId } });
    if (!conflict || conflict.project_id !== projectId || conflict.status !== "open") {
      throw new NotFoundException({ error: "conflict not found" });
    }

    const choice: ResolveChoice = rawChoice === "canonical" ? "canonical" : "candidate";
    const { filename } = conflict;

    if (choice === "candidate") {
      const candidateContent = this.relayStore.readBlob(userId, conflict.candidate_hash);
      if (candidateContent == null) {
        throw new GoneException({ error: "candidate content missing", code: "candidate_missing" });
      }
      const size = Buffer.byteLength(candidateContent, "utf8");

      await this.prisma.$transaction(async (tx) => {
        await tx.fileState.upsert({
          where: { project_id_filename: { project_id: projectId, filename } },
          create: {
            project_id: projectId,
            filename,
            hash: conflict.candidate_hash,
            size,
            last_machine_id: conflict.machine_id,
          },
          update: {
            hash: conflict.candidate_hash,
            size,
            last_machine_id: conflict.machine_id,
          },
        });
        await tx.event.create({
          data: {
            user_id: userId,
            machine_id: conflict.machine_id,
            project_id: projectId,
            type: "conflict_resolved",
            filename,
            bytes: size,
          },
        });
        await tx.conflict.update({
          where: { id: conflictId },
          data: { status: "resolved", resolved_at: new Date() },
        });
      });

      this.realtime.notifyProjectChanged(projectId, { filename, hash: conflict.candidate_hash });
    } else {
      // Canonical is kept as-is; only mark the conflict resolved and record
      // the audit event (no bytes — canonical content didn't change).
      await this.prisma.$transaction(async (tx) => {
        await tx.event.create({
          data: {
            user_id: userId,
            project_id: projectId,
            type: "conflict_resolved",
            filename,
          },
        });
        await tx.conflict.update({
          where: { id: conflictId },
          data: { status: "resolved", resolved_at: new Date() },
        });
      });
    }

    await this.notifyBestEffort({
      user_id: userId,
      type: "sync",
      title: `Conflict resolved: ${filename}`,
      body: `Kept the ${choice} version.`,
    });

    return { status: "resolved", choice };
  }

  // Notifications are best-effort: the resolve is already durably committed
  // by the time this runs, so a notify failure must not turn a successful
  // resolve into a 500 (mirrors SyncService.notifyBestEffort).
  private async notifyBestEffort(params: {
    user_id: number;
    type: string;
    title: string;
    body?: string;
  }): Promise<void> {
    try {
      await this.notify.notify(params);
    } catch (err) {
      this.logger.error(
        `notify failed (user_id=${params.user_id}, type=${params.type}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
