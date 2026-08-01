import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Put,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import { ProjectsService } from "./projects.service.js";
import { ConflictsService } from "../conflicts/conflicts.service.js";
import { SessionAuthGuard } from "../common/auth/session-auth.guard.js";
import { CurrentUser } from "../common/auth/current-user.decorator.js";
import { zodBody } from "../common/validation/zod.pipe.js";
import {
  MappingUpsertRequest,
  ProjectCreateRequest,
  ProjectUpdateRequest,
  ResolveConflictRequest,
  SyncModeRequest,
} from "@synchub/shared";

// Ports legacy hub/src/routes/projects.js, mounted at /api/projects (global
// "api" prefix). All routes require a session. sync-now is deferred
// (Phase 2c, needs realtime triggerSync) and intentionally not implemented
// here. Conflict resolution (Phase 2b) delegates to ConflictsService, which
// owns the actual resolve logic.
@Controller("projects")
@UseGuards(SessionAuthGuard)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly conflicts: ConflictsService,
  ) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.projects.listForUser(user.id);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: User,
    @Body(zodBody(ProjectCreateRequest)) body: ProjectCreateRequest,
  ) {
    return this.projects.create(user.id, body);
  }

  @Get(":id")
  detail(@CurrentUser() user: User, @Param("id", ParseIntPipe) id: number) {
    return this.projects.getDetail(user.id, id);
  }

  @Put(":id")
  update(
    @CurrentUser() user: User,
    @Param("id", ParseIntPipe) id: number,
    @Body(zodBody(ProjectUpdateRequest)) body: ProjectUpdateRequest,
  ) {
    return this.projects.update(user.id, id, body);
  }

  @Put(":id/sync-mode")
  setSyncMode(
    @CurrentUser() user: User,
    @Param("id", ParseIntPipe) id: number,
    @Body(zodBody(SyncModeRequest)) body: SyncModeRequest,
  ) {
    return this.projects.setSyncMode(user.id, id, body.sync_mode);
  }

  @Delete(":id")
  remove(@CurrentUser() user: User, @Param("id", ParseIntPipe) id: number) {
    return this.projects.remove(user.id, id);
  }

  @Put(":id/mappings/:machineId")
  upsertMapping(
    @CurrentUser() user: User,
    @Param("id", ParseIntPipe) id: number,
    @Param("machineId", ParseIntPipe) machineId: number,
    @Body(zodBody(MappingUpsertRequest)) body: MappingUpsertRequest,
  ) {
    return this.projects.upsertMapping(user.id, id, machineId, body.local_path);
  }

  @Delete(":id/mappings/:machineId")
  removeMapping(
    @CurrentUser() user: User,
    @Param("id", ParseIntPipe) id: number,
    @Param("machineId", ParseIntPipe) machineId: number,
  ) {
    return this.projects.removeMapping(user.id, id, machineId);
  }

  @Get(":id/conflicts")
  listConflicts(@CurrentUser() user: User, @Param("id", ParseIntPipe) id: number) {
    return this.projects.listOpenConflicts(user.id, id);
  }

  @Post(":id/conflicts/:conflictId/resolve")
  @HttpCode(200)
  resolveConflict(
    @CurrentUser() user: User,
    @Param("id", ParseIntPipe) id: number,
    @Param("conflictId", ParseIntPipe) conflictId: number,
    @Body(zodBody(ResolveConflictRequest)) body: ResolveConflictRequest,
  ) {
    return this.conflicts.resolve(user.id, id, conflictId, body.choice);
  }
}
