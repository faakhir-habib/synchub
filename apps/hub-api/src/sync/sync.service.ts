import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Machine } from "@prisma/client";
import type { PushRequest } from "@synchub/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { RelayStoreService } from "./relay-store.service.js";
import { MergeService } from "./merge.service.js";
import { NotifyService } from "../notify/notify.service.js";
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
  async push(machine: Machine, projectId: number, body: PushRequest): Promise<PushResult> {
    await this.requireMapping(machine, projectId);

    const started = Date.now();
    const { filename, content } = body;

    if (!isSafeFilename(filename)) {
      throw new BadRequestException({ error: "invalid filename" });
    }

    const newHash = createHash("sha256").update(content, "utf8").digest("hex");

    const current = await this.prisma.fileState.findUnique({
      where: { project_id_filename: { project_id: projectId, filename } },
    });

    // No-op: agent already has the canonical version.
    if (current && current.hash === newHash) {
      await this.touch(machine);
      return { status: "unchanged", hash: newHash };
    }

    if (current) {
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
        // Content-addressed write is durable + idempotent — do it before the
        // DB transaction so a crash between the two never loses the blob.
        const finalHash = this.relayStore.writeBlob(machine.user_id, finalContent);
        const finalSize = Buffer.byteLength(finalContent, "utf8");
        const latencyMs = Date.now() - started;

        await this.prisma.$transaction(async (tx) => {
          await tx.fileState.upsert({
            where: { project_id_filename: { project_id: projectId, filename } },
            create: {
              project_id: projectId,
              filename,
              hash: finalHash,
              size: finalSize,
              last_machine_id: machine.id,
            },
            update: {
              hash: finalHash,
              size: finalSize,
              last_machine_id: machine.id,
              updated_at: new Date(),
            },
          });
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

        // §7.4 fix: no fabricated conflict row for an auto-merge — the
        // auto_merge event above IS the audit trail.
        if (m.kind === "merged") {
          await this.notify.notify({
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
        await this.touch(machine);
        return { status: m.kind === "merged" ? "merged" : "accepted", hash: finalHash };
      }

      // True conflict — park the candidate (keyed by its own full hash — §7.4
      // fix), open a conflict, notify. Canonical untouched.
      const candidateHash = this.relayStore.writeBlob(machine.user_id, content);
      let conflictId!: number;

      await this.prisma.$transaction(async (tx) => {
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
        conflictId = c.id;
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
      });

      await this.notify.notify({
        user_id: machine.user_id,
        type: "conflict",
        title: `Conflict in ${filename}`,
        body: `${filename} diverged and needs manual resolution.`,
      });
      await this.touch(machine);
      return { status: "conflict", conflictId };
    }

    // First sync (no canonical yet): accept and make canonical.
    const hash = this.relayStore.writeBlob(machine.user_id, content);
    const size = Buffer.byteLength(content, "utf8");
    const latencyMs = Date.now() - started;

    await this.prisma.$transaction(async (tx) => {
      await tx.fileState.upsert({
        where: { project_id_filename: { project_id: projectId, filename } },
        create: { project_id: projectId, filename, hash, size, last_machine_id: machine.id },
        update: { hash, size, last_machine_id: machine.id, updated_at: new Date() },
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

    this.realtime.notifyProjectChanged(projectId, { filename, hash, excludeMachineId: machine.id });
    await this.touch(machine);
    return { status: "accepted", hash };
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
