import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { DashboardMetrics } from "@synchub/shared";
import { DashboardService, type ActivityEvent } from "./dashboard.service.js";
import { SessionAuthGuard } from "../common/auth/session-auth.guard.js";
import { CurrentUser } from "../common/auth/current-user.decorator.js";

const DEFAULT_ACTIVITY_LIMIT = 20;
const MAX_ACTIVITY_LIMIT = 100;

// Ports legacy hub/src/routes/dashboard.js, mounted at /api/dashboard (global
// "api" prefix). Both routes require a session.
@Controller("dashboard")
@UseGuards(SessionAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("metrics")
  metrics(@CurrentUser() user: User): Promise<DashboardMetrics> {
    return this.dashboard.metrics(user.id);
  }

  @Get("activity")
  activity(@CurrentUser() user: User, @Query("limit") limitParam?: string): Promise<ActivityEvent[]> {
    const parsed = Number(limitParam);
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_ACTIVITY_LIMIT) : DEFAULT_ACTIVITY_LIMIT;
    return this.dashboard.activity(user.id, limit);
  }
}
