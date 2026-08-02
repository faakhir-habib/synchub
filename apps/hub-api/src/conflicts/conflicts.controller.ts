import { Controller, Get, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import { ConflictsService } from "./conflicts.service.js";
import { SessionAuthGuard } from "../common/auth/session-auth.guard.js";
import { CurrentUser } from "../common/auth/current-user.decorator.js";

// Ports legacy hub/src/routes/conflicts.js, mounted at /api/conflicts (global
// "api" prefix). Top-level view: every open conflict across the user's
// projects. Conflict resolution is Phase 2b and intentionally not here.
@Controller("conflicts")
@UseGuards(SessionAuthGuard)
export class ConflictsController {
  constructor(private readonly conflicts: ConflictsService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.conflicts.listOpenForUser(user.id);
  }
}
