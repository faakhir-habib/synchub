import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Machine } from "@prisma/client";
import type { PushRequest } from "@synchub/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { RelayStoreService } from "./relay-store.service.js";
import { MergeService } from "./merge.service.js";
import { NotifyService } from "../notify/notify.service.js";
import type { NotifyParams } from "../notify/notify.service.js";
import { REALTIME_PORT } from "../realtime/realtime.port.js";
import type { RealtimePort } from "../realtime/realtime.port.js";

// Ported from hub/src/lib/relayStore.js#isSafeFilename. A filename is a
// Claude session transcript name (UUID + .jsonl) — reject anything that
// could be a path-traversal attempt or otherwise unexpected shape. Exported
// so Task 5's push route can reuse the exact same validation.
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export function isSafeFilename(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name.length <= 255 && SAFE_NAME.test(name);
}

export interface MachineMapping {
  project_id: number;
  machine_id: number;
  local_path: string;
  alias: string;
  sync_mode: string;
}

export interface FileStateEntry {
  filename: string;
  hash: string;
  size: number;
  updated_at: string;
}

// Result of SyncService.push. The "conflict" variant deliberately carries no
// other fields — the controller mirrors this object as the HTTP 409 body
// verbatim, so it must be exactly {status:"conflict", conflictId}.
export type PushResult =
  | { status: "unchanged" | "behind" | "accepted" | "merged"; hash: string }
  | { status: "conflict"; conflictId: number };

// Agent-facing sync endpoints. Ports legacy hub/src/routes/agent.js.
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly relayStore: RelayStoreService,
    private readonly merge: MergeService,
    private readonly notify: NotifyService,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
  ) {}

  // What this machine should watch, and in what mode.
  async listMappings(machine: Machine): Promise<MachineMapping[]> {
    await this.touch(machine);

    const rows = await this.prisma.mapping.findMany({
      where: { machine_id: machine.id },
      include: { project: { select: { alias: true, sync_mode: true } } },
      orderBy: { project: { alias: "asc" } },
    });

    return rows.map((m) => ({
      project_id: m.project_id,
      machine_id: m.machine_id,
      local_path: m.local_path,
      alias: m.project.alias,
      sync_mode: m.project.sync_mode,
    }));
  }

  // Canonical {filename, hash, size, updated_at} for every file in a project.
  async manifest(machine: Machine, projectId: number): Promise<FileStateEntry[]> {
    await this.requireMapping(machine, projectId);
    await this.touch(machine);

    const rows = await this.prisma.fileState.findMany({
      where: { project_id: projectId },
      orderBy: { filename: "asc" },
    });

    return rows.map((f) => ({
      filename: f.filename,
      hash: f.hash,
      size: f.size,
      updated_at: f.updated_at.toISOString(),
    }));
  }

  // Download canonical content for one file. Does not touch (matches legacy).
  async pull(machine: Machine, projectId: number, filename: string): Promise<string> {
    await this.requireMapping(machine, projectId);

    if (!isSafeFilename(filename)) {
      throw new BadRequestException({ error: "invalid filename" });
    }

    const fileState = await this.prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: projectId, filename } },
    });
    if (!fileState) {
      throw new NotFoundException({ error: "not found" });
    }

    const content = this.relayStore.readBlob(machine.user_id, fileState.hash);
    if (content == null) {
      throw new NotFoundException({ error: "not found" });
    }

    return content;
  }

  // Push a local file. base_hash is the agent's last-known canonical hash —
  // ADVISORY ONLY (audit §7.2): it is never trusted to authorize a blind
  // overwrite. Whenever a canonical version already exists, we always run
  // autoMerge against it, so a stale/lying base_hash can extend or merge
  // canonical but can never silently drop lines the agent doesn't know about.
  //
  // Concurrency: this handler is async (unlike legacy's synchronous
  // better-sqlite3 handler, which was atomic per-request by construction).
  // Between reading `current` and committing the merge result there's a
  // yield, so two concurrent pushes to the SAME file can both read the same
  // `current`, each merge only their own tail, and the second write would
  // silently clobber the first — a lost update despite both returning 200.
  // `attemptPush` guards its canonical write with compare-and-swap (scoped
  // to the hash it read); a lost race returns "retry" and we re-read + re-
  // merge against the fresh canonical. Bounded so a pathological hot file
  // can't spin forever.
  async push(machine: Machine, projectId: number, body: PushRequest): Promise<PushResult> {
    await this.requireMapping(machine, projectId);

    const started = Date.now();
    const { filename, content } = body;

    if (!isSafeFilename(filename)) {
      throw new BadRequestException({ error: "invalid filename" });
    }

    const newHash = createHash("sha256").update(content, "utf8").digest("hex");

    const MAX_ATTEMPTS = 5;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = await this.attemptPush(machine, projectId, filename, content, newHash, started);
      if (result !== "retry") {
        return result;
      }
    }

    // Retries exhausted: pathological contention (every one of MAX_ATTEMPTS
    // attempts lost its CAS to a concurrent writer on the same file). This
    // should essentially never happen in practice. Surface as 503 rather
    // than guessing at an outcome — this must never masquerade as a
    // resolved "accepted"/"merged"/"conflict" result, since none of those
    // actually committed. The agent already retries pushes on failure.
    throw new HttpException(
      { error: "push contention exhausted retries, please retry", code: "push_contention" },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  // One attempt of the push decision tree. Returns the terminal PushResult,
  // or the string "retry" if a concurrent writer won a compare-and-swap race
  // and the caller should re-read canonical and try again.
  private async attemptPush(
    machine: Machine,
    projectId: number,
    filename: string,
    content: string,
    newHash: string,
    started: number,
  ): Promise<PushResult | "retry"> {
    const current = await this.prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: projectId, filename } },
    });

    if (!current) {
      // First sync for this file. Another machine's first-sync push for the
      // SAME (project_id, filename) could land concurrently, so use a plain
      // `create` (not `upsert`) — the unique constraint turns that race into
      // a P2002 we can retry against, instead of one writer silently
      // clobbering the other's canonical.
      const hash = this.relayStore.writeBlob(machine.user_id, content);
      const size = Buffer.byteLength(content, "utf8");
      const latencyMs = Date.now() - started;

      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.fileState.create({
            data: { project_id: projectId, filename, hash, size, last_machine_id: machine.id },
          });
          await tx.event.create({
            data: {
              user_id: machine.user_id,
              machine_id: machine.id,
              project_id: projectId,
              type: "push",
              filename,
              bytes: size,
              latency_ms: latencyMs,
            },
          });
        });
      } catch (err) {
        if (this.isUniqueConstraintError(err)) {
          // Someone else's first-sync won; retry will see `current` and
          // autoMerge against it instead of losing this push's content.
          return "retry";
        }
        throw err;
      }

      this.realtime.notifyProjectChanged(projectId, { filename, hash, excludeMachineId: machine.id });
      this.emitPushComplete(machine, projectId, filename);
      await this.touch(machine);
      return { status: "accepted", hash };
    }

    // No-op: agent already has the canonical version.
    if (current.hash === newHash) {
      await this.touch(machine);
      return { status: "unchanged", hash: newHash };
    }

    const canonical = this.relayStore.readBlob(machine.user_id, current.hash) ?? "";
    const m = this.merge.autoMerge(canonical, content);

    // Incoming is behind canonical — nothing to do; tell the agent to pull.
    if (m.kind === "behind") {
      await this.touch(machine);
      return { status: "behind", hash: current.hash };
    }

    // Forward extension or clean append-merge — write the result as canonical.
    if (m.kind === "forward" || m.kind === "merged") {
      const finalContent = m.merged as string;
      // Content-addressed write is durable + idempotent — safe to do before
      // the CAS regardless of whether this attempt wins: a losing attempt
      // just leaves an orphan blob, reclaimed later by GC.
      const finalHash = this.relayStore.writeBlob(machine.user_id, finalContent);
      const finalSize = Buffer.byteLength(finalContent, "utf8");
      const latencyMs = Date.now() - started;

      // Compare-and-swap: only commit if canonical is still exactly the
      // `current.hash` we read above. If another push already moved it,
      // `count` is 0 and we retry against the fresh canonical instead of
      // clobbering it. The event is created in the SAME transaction as the
      // guarded update, so it only ever records on a successful CAS.
      let casCount = 0;
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.fileState.updateMany({
          where: { project_id: projectId, filename, hash: current.hash },
          data: { hash: finalHash, size: finalSize, last_machine_id: machine.id, updated_at: new Date() },
        });
        casCount = updated.count;
        if (casCount === 0) return;

        await tx.event.create({
          data: {
            user_id: machine.user_id,
            machine_id: machine.id,
            project_id: projectId,
            type: m.kind === "merged" ? "auto_merge" : "push",
            filename,
            bytes: finalSize,
            latency_ms: latencyMs,
          },
        });
      });

      if (casCount === 0) {
        return "retry";
      }

      // §7.4 fix: no fabricated conflict row for an auto-merge — the
      // auto_merge event above IS the audit trail.
      if (m.kind === "merged") {
        await this.notifyBestEffort({
          user_id: machine.user_id,
          type: "sync",
          title: `Auto-merged ${filename}`,
          body: `Diverging edits to ${filename} were merged automatically.`,
        });
      }

      this.realtime.notifyProjectChanged(projectId, {
        filename,
        hash: finalHash,
        excludeMachineId: machine.id,
      });
      this.emitPushComplete(machine, projectId, filename);
      await this.touch(machine);
      return { status: m.kind === "merged" ? "merged" : "accepted", hash: finalHash };
    }

    // True conflict — park the candidate (keyed by its own full hash — §7.4
    // fix), open a conflict, notify. Canonical untouched, so there's no CAS
    // risk here and this branch is never retried for the file-state write —
    // but a partial unique index (uniq_open_conflict: project_id+filename
    // WHERE status='open', see schema.prisma) enforces at most one OPEN
    // conflict row per file, so two concurrent conflicting pushes to the
    // SAME file can both reach this branch and race to create it.
    const candidateHash = this.relayStore.writeBlob(machine.user_id, content);
    let conflictId: number;

    try {
      conflictId = await this.prisma.$transaction(async (tx) => {
        const c = await tx.conflict.create({
          data: {
            project_id: projectId,
            filename,
            machine_id: machine.id,
            candidate_hash: candidateHash,
            auto_merged: 0,
            status: "open",
          },
        });
        await tx.event.create({
          data: {
            user_id: machine.user_id,
            machine_id: machine.id,
            project_id: projectId,
            type: "conflict",
            filename,
            bytes: Buffer.byteLength(content, "utf8"),
            // legacy records no latency_ms on the conflict path
          },
        });
        return c.id;
      });
    } catch (err) {
      if (!this.isUniqueConstraintError(err)) {
        throw err;
      }
      // Lost the race on uniq_open_conflict: another push already opened a
      // conflict for this exact file microseconds earlier. Surface ITS id
      // rather than erroring or creating a second open conflict row — both
      // conflicting pushes end up pointing at the same one to resolve.
      const existing = await this.prisma.conflict.findFirst({
        where: { project_id: projectId, filename, status: "open" },
        orderBy: { created_at: "asc" },
      });
      if (!existing) {
        // Unreachable in practice: a P2002 on uniq_open_conflict means an
        // open row exists by definition. Don't swallow a genuinely
        // different unique-constraint error behind a confusing conflict
        // response if this invariant is ever violated.
        throw err;
      }
      conflictId = existing.id;
      await this.touch(machine);
      return { status: "conflict", conflictId };
    }

    await this.notifyBestEffort({
      user_id: machine.user_id,
      type: "conflict",
      title: `Conflict in ${filename}`,
      body: `${filename} diverged and needs manual resolution.`,
    });
    await this.touch(machine);
    return { status: "conflict", conflictId };
  }

  // Remove a file's canonical record and fan out so other agents + browsers
  // drop it too (audit #5/#12 — kill file resurrection at the source: once
  // the file_state row is gone, a stale agent's next manifest diff will no
  // longer see it as "missing locally, needs pull" and resurrect it).
  // Idempotent: deleting an already-gone filename is a no-op 200, not a 404,
  // so a retried/duplicate delete from a flaky agent connection is safe.
  async deleteFile(machine: Machine, projectId: number, filename: string): Promise<{ status: "deleted" }> {
    await this.requireMapping(machine, projectId);

    if (!isSafeFilename(filename)) {
      throw new BadRequestException({ error: "invalid filename" });
    }

    // Delete is last-delete-wins by design (spec §4) — deliberately NOT
    // hash-guarded (no CAS) the way push's canonical write is. A concurrent
    // push racing this delete either loses (its write lands first, then this
    // delete removes the row it just wrote) or wins (the file_state row it
    // creates lands after this delete, which is indistinguishable from a
    // normal first-sync). Either outcome is fine: there is no persistent
    // deleted-here/alive-there split, so adding CAS here would only reject
    // legitimate concurrent pushes for no correctness benefit.
    const existing = await this.prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: projectId, filename } },
    });

    if (existing) {
      // deleteMany (not delete): guards against a race where a concurrent
      // duplicate delete already removed the row between the read above and
      // this write — `count` would be 0 and we simply skip the event/fan-out
      // rather than throwing on a missing record.
      const deleted = await this.prisma.$transaction(async (tx) => {
        const result = await tx.fileState.deleteMany({
          where: { project_id: projectId, filename },
        });
        if (result.count === 0) return false;

        await tx.event.create({
          data: {
            user_id: machine.user_id,
            machine_id: machine.id,
            project_id: projectId,
            type: "delete",
            filename,
            // `existing.size` is a pre-transaction read, so under the race
            // above it could be stale by the time this commits — cosmetic
            // event metadata only, not worth restructuring for.
            bytes: existing.size,
          },
        });
        return true;
      });

      // Deliberately NOT deleting the blob here — content is content-
      // addressed and may still be referenced elsewhere; the existing orphan
      // GC (relay-store's reclaim pass) reclaims it once nothing points to
      // it anymore.
      if (deleted) {
        // Fan-out is best-effort: the delete itself already committed above,
        // so a transient failure in this lookup or in notifyDeleted (e.g. a
        // DB hiccup) must never turn an already-successful delete into a 500
        // for the agent — matches notifyBestEffort's rationale for push.
        try {
          const project = await this.prisma.project.findUnique({
            where: { id: projectId },
            select: { user_id: true },
          });
          if (project) {
            this.realtime.notifyDeleted(project.user_id, projectId, filename, machine.id);
          }
        } catch (err) {
          this.logger.error(
            `delete fan-out failed (project_id=${projectId}, filename=${filename}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    await this.touch(machine);
    return { status: "deleted" };
  }

  // Live progress + completion for the pushing user's own browsers, fired
  // AFTER the persisting transaction commits — single-file push, so it's
  // always completed:1/total:1 (richer multi-file granularity is a Phase-4
  // agent concern). Fire-and-forget: RealtimePort methods return void and
  // the gateway swallows its own errors, so this can never turn an
  // otherwise-successful push into a failure.
  private emitPushComplete(machine: Machine, projectId: number, filename: string): void {
    this.realtime.syncProgress(machine.user_id, {
      projectId,
      machineId: machine.id,
      filename,
      completed: 1,
      total: 1,
      phase: "push",
    });
    this.realtime.syncComplete(machine.user_id, {
      projectId,
      machineId: machine.id,
      at: new Date().toISOString(),
    });
  }

  // Notifications are best-effort: a canonical write or conflict row is
  // already durably committed by the time this runs, so a notify failure
  // (e.g. a transient DB hiccup) must not turn an otherwise-successful push
  // into a 500.
  private async notifyBestEffort(params: NotifyParams): Promise<void> {
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

  private isUniqueConstraintError(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
  }

  // Require that `machine` is mapped into `projectId`; throws 404 otherwise.
  private async requireMapping(machine: Machine, projectId: number): Promise<void> {
    const mapping = await this.prisma.mapping.findFirst({
      where: { project_id: projectId, machine_id: machine.id },
    });
    if (!mapping) {
      throw new NotFoundException({ error: "not mapped to project", code: "not_mapped" });
    }
  }

  private async touch(machine: Machine): Promise<void> {
    await this.prisma.machine.update({
      where: { id: machine.id },
      data: { status: "online", last_seen_at: new Date() },
    });
  }
}
