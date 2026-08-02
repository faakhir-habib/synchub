import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsService } from "./notifications.service.js";
import { AuthModule } from "../common/auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
