import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Machine } from "@prisma/client";
import type { Response } from "express";
import { DeleteRequest, PushRequest } from "@synchub/shared";
import { SyncService } from "./sync.service.js";
import { MachineAuthGuard } from "../common/auth/machine-auth.guard.js";
import { CurrentMachine } from "../common/auth/current-user.decorator.js";
import { zodBody } from "../common/validation/zod.pipe.js";

// Agent-facing sync endpoints, mounted at /api/agent/* (global "api" prefix).
// Auth via X-Machine-Token (MachineAuthGuard). Ports legacy
// hub/src/routes/agent.js.
@Controller("agent")
@UseGuards(MachineAuthGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get("mappings")
  listMappings(@CurrentMachine() machine: Machine) {
    return this.sync.listMappings(machine);
  }

  @Get("manifest/:projectId")
  manifest(@CurrentMachine() machine: Machine, @Param("projectId", ParseIntPipe) projectId: number) {
    return this.sync.manifest(machine, projectId);
  }

  @Get("pull/:projectId/:filename")
  async pull(
    @CurrentMachine() machine: Machine,
    @Param("projectId", ParseIntPipe) projectId: number,
    @Param("filename") filename: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const content = await this.sync.pull(machine, projectId, filename);
    // Set the content-type only on the success path — if `pull` throws (404
    // not mapped / 400 invalid filename / 404 not found), AllExceptionsFilter
    // must be free to set its own (application/json) content-type. Setting
    // this unconditionally (e.g. via @Header()) would pre-empt that: Express's
    // res.json() only sets Content-Type when none is already set, so an
    // error response would incorrectly go out as x-ndjson.
    res.type("application/x-ndjson");
    return content;
  }

  @Post("push/:projectId")
  @HttpCode(200)
  async push(
    @CurrentMachine() machine: Machine,
    @Param("projectId", ParseIntPipe) projectId: number,
    @Body(zodBody(PushRequest)) body: PushRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.sync.push(machine, projectId, body);
    // The "conflict" branch must come back as HTTP 409 with a body that is
    // EXACTLY {status:"conflict", conflictId} — set the status explicitly
    // (passthrough response) rather than throwing, so AllExceptionsFilter's
    // {error,code} reshaping never touches this body.
    if (result.status === "conflict") {
      res.status(409);
    }
    return result;
  }

  @Post("delete/:projectId")
  @HttpCode(200)
  delete(
    @CurrentMachine() machine: Machine,
    @Param("projectId", ParseIntPipe) projectId: number,
    @Body(zodBody(DeleteRequest)) body: DeleteRequest,
  ) {
    return this.sync.deleteFile(machine, projectId, body.filename);
  }
}
