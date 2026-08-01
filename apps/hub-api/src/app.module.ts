import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { LegacyHealthController } from "./health/legacy-health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { AuthModule } from "./common/auth/auth.module.js";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [HealthController, LegacyHealthController],
})
export class AppModule {}
