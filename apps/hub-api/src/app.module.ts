import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { LegacyHealthController } from "./health/legacy-health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { AuthModule } from "./common/auth/auth.module.js";
import { UsersModule } from "./users/users.module.js";
import { MachinesModule } from "./machines/machines.module.js";

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, MachinesModule],
  controllers: [HealthController, LegacyHealthController],
})
export class AppModule {}
