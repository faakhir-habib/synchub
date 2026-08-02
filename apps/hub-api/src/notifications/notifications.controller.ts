import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { NotificationsSummary } from "@synchub/shared";
import { NotificationsService } from "./notifications.service.js";
import { SessionAuthGuard } from "../common/auth/session-auth.guard.js";
import { CurrentUser } from "../common/auth/current-user.decorator.js";

// Ports legacy hub/src/routes/notifications.js, mounted at /api/notifications
// (global "api" prefix). All routes require a session.
@Controller("notifications")
@UseGuards(SessionAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  summary(@CurrentUser() user: User): Promise<NotificationsSummary> {
    return this.notifications.summary(user.id);
  }

  @Post(":id/read")
  @HttpCode(200)
  markRead(@CurrentUser() user: User, @Param("id", ParseIntPipe) id: number) {
    return this.notifications.markRead(user.id, id);
  }

  @Post("read-all")
  @HttpCode(200)
  markAllRead(@CurrentUser() user: User) {
    return this.notifications.markAllRead(user.id);
  }
}
