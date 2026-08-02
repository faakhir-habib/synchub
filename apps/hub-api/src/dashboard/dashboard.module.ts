import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardService } from "./dashboard.service.js";
import { AuthModule } from "../common/auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
