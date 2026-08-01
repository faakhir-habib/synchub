import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Project as PrismaProject } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import type {
  Conflict,
  Project,
  ProjectCreateRequest,
  ProjectDetail,
  ProjectUpdateRequest,
  SyncMode,
} from "@synchub/shared";

const PRISMA_UNIQUE_CONSTRAINT = "P2002";

// Ports legacy hub/src/routes/projects.js + hub/src/models/{projects,mappings,fileState,events,conflicts}.js.
// Excludes sync-now (Phase 2c, needs realtime) and conflict resolution (Phase 2b, needs relay store).
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: number): Promise<Project[]> {
    const projects = await this.prisma.project.findMany({
      where: { user_id: userId },
      orderBy: { created_at: "asc" },
    });
    return projects.map((p) => this.toProject(p));
  }

  async create(userId: number, body: ProjectCreateRequest): Promise<Project> {
    const alias = body.alias.trim();
    if (!alias) {
      throw new BadRequestException({ error: "alias required", code: "alias_required" });
    }

    try {
      const project = await this.prisma.project.create({
        data: {
          user_id: userId,
          alias,
          sync_mode: body.sync_mode ?? "auto",
        },
      });
      return this.toProject(project);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException({ error: "alias already exists", code: "alias_exists" });
      }
      throw err;
    }
  }

  // Returns the raw project row for an owned project, or null. Callers that
  // need a 404 use findOwnedOrThrow instead.
  async findOwned(userId: number, id: number): Promise<PrismaProject | null> {
    return this.prisma.project.findFirst({ where: { id, user_id: userId } });
  }

  private async findOwnedOrThrow(userId: number, id: number): Promise<PrismaProject> {
    const project = await this.findOwned(userId, id);
    if (!project) {
      throw new NotFoundException({ error: "not found" });
    }
    return project;
  }

  async getDetail(userId: number, id: number): Promise<ProjectDetail> {
    const project = await this.findOwnedOrThrow(userId, id);

    const [mappingRows, trackedFiles, lastSync, activity] = await Promise.all([
      this.prisma.mapping.findMany({
        where: { project_id: project.id },
        include: { machine: true },
      }),
      this.prisma.fileState.count({ where: { project_id: project.id } }),
      this.prisma.fileState.aggregate({
        where: { project_id: project.id },
        _max: { updated_at: true },
      }),
      this.prisma.event.findMany({
        where: { project_id: project.id },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        take: 10,
      }),
    ]);

    return {
      ...this.toProject(project),
      mappings: mappingRows.map((m) => ({
        machine_id: m.machine_id,
        local_path: m.local_path,
        alias: m.machine?.name ?? null,
      })),
      tracked_files: trackedFiles,
      last_sync_at: lastSync._max.updated_at ? lastSync._max.updated_at.toISOString() : null,
      activity,
    };
  }

  // Update alias and/or sync_mode for an owned project. sync_mode is already
  // validated against the SyncMode enum by the zod DTO at the controller layer.
  async update(userId: number, id: number, body: ProjectUpdateRequest): Promise<Project> {
    await this.findOwnedOrThrow(userId, id);

    let alias: string | undefined;
    if (body.alias !== undefined) {
      alias = body.alias.trim();
      if (!alias) {
        throw new BadRequestException({ error: "alias cannot be empty", code: "alias_empty" });
      }
    }

    try {
      const project = await this.prisma.project.update({
        where: { id },
        data: {
          ...(alias !== undefined ? { alias } : {}),
          ...(body.sync_mode !== undefined ? { sync_mode: body.sync_mode } : {}),
        },
      });
      return this.toProject(project);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException({ error: "alias already exists", code: "alias_exists" });
      }
      throw err;
    }
  }

  async setSyncMode(userId: number, id: number, syncMode: SyncMode): Promise<Project> {
    await this.findOwnedOrThrow(userId, id);
    const project = await this.prisma.project.update({
      where: { id },
      data: { sync_mode: syncMode },
    });
    return this.toProject(project);
  }

  async remove(userId: number, id: number): Promise<{ ok: true }> {
    const result = await this.prisma.project.deleteMany({ where: { id, user_id: userId } });
    if (result.count === 0) {
      throw new NotFoundException({ error: "not found" });
    }
    return { ok: true };
  }

  async upsertMapping(userId: number, projectId: number, machineId: number, localPath: string) {
    await this.findOwnedOrThrowWithMessage(userId, projectId, "project not found");

    const machine = await this.prisma.machine.findFirst({
      where: { id: machineId, user_id: userId },
    });
    if (!machine) {
      throw new NotFoundException({ error: "machine not found" });
    }

    const trimmed = localPath?.trim();
    if (!trimmed) {
      throw new BadRequestException({ error: "local_path required", code: "local_path_required" });
    }

    return this.prisma.mapping.upsert({
      where: { project_id_machine_id: { project_id: projectId, machine_id: machineId } },
      create: { project_id: projectId, machine_id: machineId, local_path: trimmed },
      update: { local_path: trimmed },
    });
  }

  async removeMapping(userId: number, projectId: number, machineId: number): Promise<{ ok: true }> {
    await this.findOwnedOrThrowWithMessage(userId, projectId, "project not found");

    const result = await this.prisma.mapping.deleteMany({
      where: { project_id: projectId, machine_id: machineId },
    });
    if (result.count === 0) {
      throw new NotFoundException({ error: "mapping not found" });
    }
    return { ok: true };
  }

  async listOpenConflicts(userId: number, projectId: number): Promise<Conflict[]> {
    await this.findOwnedOrThrow(userId, projectId);

    const conflicts = await this.prisma.conflict.findMany({
      where: { project_id: projectId, status: "open" },
      orderBy: { created_at: "desc" },
    });

    return conflicts.map((c) => ({
      id: c.id,
      project_id: c.project_id,
      filename: c.filename,
      status: c.status as Conflict["status"],
      auto_merged: c.auto_merged !== 0,
      created_at: c.created_at.toISOString(),
    }));
  }

  private async findOwnedOrThrowWithMessage(
    userId: number,
    id: number,
    message: string,
  ): Promise<PrismaProject> {
    const project = await this.findOwned(userId, id);
    if (!project) {
      throw new NotFoundException({ error: message });
    }
    return project;
  }

  private toProject(p: PrismaProject): Project {
    return {
      id: p.id,
      alias: p.alias,
      sync_mode: p.sync_mode as SyncMode,
      created_at: p.created_at.toISOString(),
    };
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PRISMA_UNIQUE_CONSTRAINT
  );
}
