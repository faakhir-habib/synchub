import {
  BadRequestException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
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

export type ResolveChoice = "candidate" | "canonical" | "manual";

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

  // Fetch both sides of an open conflict's content, for the browser's diff
  // view. Same ownership/lookup guard as resolve(). Candidate is read by its
  // pinned candidate_hash; canonical is read via the CURRENT FileState row
  // for this file (there's no snapshot of "canonical at conflict time" on
  // the Conflict row itself — see the schema comment on Conflict).
  async getContent(
    userId: number,
    projectId: number,
    conflictId: number,
  ): Promise<{ candidate: string; canonical: string }> {
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

    const candidate = this.relayStore.readBlob(userId, conflict.candidate_hash);
    if (candidate == null) {
      throw new GoneException({ error: "candidate content missing", code: "candidate_missing" });
    }

    // A conflict can't exist without a prior FileState row in practice (the
    // very first push for a file has nothing to diverge from), but treat a
    // missing row/blob as an empty canonical defensively rather than
    // erroring the whole resolver over an edge case that shouldn't happen.
    const fileState = await this.prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: projectId, filename: conflict.filename } },
    });
    const canonical = fileState ? (this.relayStore.readBlob(userId, fileState.hash) ?? "") : "";

    return { candidate, canonical };
  }

  // Resolve an open conflict by keeping the pushed "candidate", the existing
  // "canonical" version, or a hand-edited "manual" merge. Ports
  // hub/src/routes/projects.js's `POST /:id/conflicts/:conflictId/resolve`
  // handler (candidate/canonical), with the legacy `store.read/write`
  // (name-derived flat files) replaced by the content-addressed RelayStore,
  // plus a "manual" choice for the git-style resolver's merge editor.
  async resolve(
    userId: number,
    projectId: number,
    conflictId: number,
    rawChoice: unknown,
    content?: string,
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

    const choice: ResolveChoice =
      rawChoice === "canonical" ? "canonical" : rawChoice === "manual" ? "manual" : "candidate";
    const { filename } = conflict;

    if (choice === "candidate") {
      const candidateContent = this.relayStore.readBlob(userId, conflict.candidate_hash);
      if (candidateContent == null) {
        throw new GoneException({ error: "candidate content missing", code: "candidate_missing" });
      }
      const size = Buffer.byteLength(candidateContent, "utf8");
      await this.applyResolution(userId, projectId, conflictId, conflict, conflict.candidate_hash, size);
    } else if (choice === "manual") {
      // The zod schema (ResolveConflictRequest) already requires `content`
      // whenever choice is "manual" — this is defense-in-depth for any
      // caller that bypasses that validation (e.g. a future internal call).
      if (content === undefined) {
        throw new BadRequestException({ error: "content is required for manual resolution" });
      }
      this.assertValidJsonl(content);

      // writeBlob dedupes identical content, so submitting the editor
      // unedited (byte-identical to either side) just reuses that blob's
      // existing hash rather than writing a redundant copy.
      const hash = this.relayStore.writeBlob(userId, content);
      const size = Buffer.byteLength(content, "utf8");
      await this.applyResolution(userId, projectId, conflictId, conflict, hash, size);
    } else {
      // Canonical is kept as-is; only mark the conflict resolved and record
      // the audit event (no bytes — canonical content didn't change).
      await this.prisma.$transaction(async (tx) => {
        // Same CAS guard as applyResolution's candidate/manual paths.
        const cas = await tx.conflict.updateMany({
          where: { id: conflictId, status: "open" },
          data: { status: "resolved", resolved_at: new Date() },
        });
        if (cas.count === 0) {
          throw new NotFoundException({ error: "conflict not open", code: "conflict_not_open" });
        }

        await tx.event.create({
          data: {
            user_id: userId,
            project_id: projectId,
            type: "conflict_resolved",
            filename,
          },
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

  // Shared by the "candidate" and "manual" resolve branches — the only
  // difference between them is where `hash`/`size` come from (the pinned
  // candidate_hash vs. a freshly written blob of the edited content).
  private async applyResolution(
    userId: number,
    projectId: number,
    conflictId: number,
    conflict: { filename: string; machine_id: number | null },
    hash: string,
    size: number,
  ): Promise<void> {
    const { filename } = conflict;

    await this.prisma.$transaction(async (tx) => {
      // Compare-and-swap: only proceed if the conflict is still "open" at
      // commit time. This is the authoritative guard against a double-
      // resolve race (two concurrent requests for the same conflict — the
      // pre-transaction open-check in resolve() is only a fast-path
      // optimization and is not itself atomic with the writes below). Run
      // this FIRST so a losing request does the least work before rolling
      // back.
      const cas = await tx.conflict.updateMany({
        where: { id: conflictId, status: "open" },
        data: { status: "resolved", resolved_at: new Date() },
      });
      if (cas.count === 0) {
        throw new NotFoundException({ error: "conflict not open", code: "conflict_not_open" });
      }

      await tx.fileState.upsert({
        where: { project_id_filename: { project_id: projectId, filename } },
        create: {
          project_id: projectId,
          filename,
          hash,
          size,
          last_machine_id: conflict.machine_id,
        },
        update: {
          hash,
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
    });

    this.realtime.notifyProjectChanged(projectId, { filename, hash });
  }

  // A manual resolution replaces the canonical content outright, so a
  // malformed edit (e.g. a stray unescaped quote breaking one line's JSON)
  // would otherwise corrupt the file for every other machine that pulls it
  // next — reject it up front instead, mirroring MergeService's own
  // "invalid JSON line ⇒ unsafe to proceed" reasoning.
  private assertValidJsonl(content: string): void {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "") continue;
      try {
        JSON.parse(lines[i]);
      } catch {
        throw new BadRequestException({
          error: `invalid JSON on line ${i + 1} of the manual resolution`,
          code: "invalid_jsonl",
        });
      }
    }
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
