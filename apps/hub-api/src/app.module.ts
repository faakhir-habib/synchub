import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { LegacyHealthController } from "./health/legacy-health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";

@Module({
  imports: [PrismaModule],
  controllers: [HealthController, LegacyHealthController],
})
export class AppModule {}
