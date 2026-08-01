import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import type { Request } from "express";
import { MachinesService } from "./machines.service.js";
import { SessionAuthGuard } from "../common/auth/session-auth.guard.js";
import { CurrentUser } from "../common/auth/current-user.decorator.js";
import { zodBody } from "../common/validation/zod.pipe.js";
import { MachineCreateRequest } from "@synchub/shared";

// Ports legacy hub/src/routes/machines.js#machineRoutes, mounted at
// /api/machines (global "api" prefix). All routes require a session.
@Controller("machines")
@UseGuards(SessionAuthGuard)
export class MachinesController {
  constructor(private readonly machines: MachinesService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.machines.listForUser(user.id);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: User,
    @Body(zodBody(MachineCreateRequest)) body: MachineCreateRequest,
    @Req() req: Request,
  ) {
    return this.machines.create(user.id, body, req.ip ?? null);
  }

  @Delete(":id")
  remove(@CurrentUser() user: User, @Param("id", ParseIntPipe) id: number) {
    return this.machines.remove(user.id, id);
  }

  @Post("pair")
  @HttpCode(201)
  pair(@CurrentUser() user: User) {
    return this.machines.createPairingCode(user.id);
  }
}
