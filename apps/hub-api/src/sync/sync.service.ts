import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Machine } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { RelayStoreService } from "./relay-store.service.js";

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

// Agent-facing read endpoints. Ports legacy hub/src/routes/agent.js (GET
// routes only — push is Task 5, not here).
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly relayStore: RelayStoreService,
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
