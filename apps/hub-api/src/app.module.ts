import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { HealthController } from "./health/health.controller.js";
import { LegacyHealthController } from "./health/legacy-health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { AuthModule } from "./common/auth/auth.module.js";
import { UsersModule } from "./users/users.module.js";
import { MachinesModule } from "./machines/machines.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { NotifyModule } from "./notify/notify.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { ConflictsModule } from "./conflicts/conflicts.module.js";
import { DashboardModule } from "./dashboard/dashboard.module.js";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    MachinesModule,
    ProjectsModule,
    NotifyModule,
    NotificationsModule,
    ConflictsModule,
    DashboardModule,
  ],
  controllers: [HealthController, LegacyHealthController],
})
export class AppModule {}
