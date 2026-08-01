import { Module } from "@nestjs/common";
import { ConflictsController } from "./conflicts.controller.js";
import { ConflictsService } from "./conflicts.service.js";
import { AuthModule } from "../common/auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [ConflictsController],
  providers: [ConflictsService],
})
export class ConflictsModule {}
