import { Module } from "@nestjs/common";
import { SessionAuthGuard } from "./session-auth.guard.js";
import { MachineAuthGuard } from "./machine-auth.guard.js";

// Provides SessionAuthGuard/MachineAuthGuard so Nest's DI can instantiate
// them (they inject PrismaService) wherever a controller applies
// `@UseGuards(SessionAuthGuard | MachineAuthGuard)`. Guards are applied
// per-controller/per-route, never registered globally via APP_GUARD.
@Module({
  providers: [SessionAuthGuard, MachineAuthGuard],
  exports: [SessionAuthGuard, MachineAuthGuard],
})
export class AuthModule {}
