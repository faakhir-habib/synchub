import { Module } from "@nestjs/common";
import { SessionAuthGuard } from "./session-auth.guard.js";
import { MachineAuthGuard } from "./machine-auth.guard.js";
import { SessionSweepService } from "./session-sweep.service.js";

// Provides SessionAuthGuard/MachineAuthGuard so Nest's DI can instantiate
// them (they inject PrismaService) wherever a controller applies
// `@UseGuards(SessionAuthGuard | MachineAuthGuard)`. Guards are applied
// per-controller/per-route, never registered globally via APP_GUARD.
//
// Also provides SessionSweepService, a @Cron job that purges expired
// sessions daily. It relies on ScheduleModule.forRoot() being imported
// once at the app root (see app.module.ts) to activate @Cron() handlers.
@Module({
  providers: [SessionAuthGuard, MachineAuthGuard, SessionSweepService],
  exports: [SessionAuthGuard, MachineAuthGuard],
})
export class AuthModule {}
