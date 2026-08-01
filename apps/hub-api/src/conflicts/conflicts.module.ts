import { Module } from "@nestjs/common";
import { ConflictsController } from "./conflicts.controller.js";
import { ConflictsService } from "./conflicts.service.js";
import { AuthModule } from "../common/auth/auth.module.js";
import { SyncModule } from "../sync/sync.module.js";

// Imports SyncModule to get RelayStoreService (SyncModule exports it) for
// reading candidate blobs on resolve. This is a one-way dependency: Sync
// never imports Conflicts, so no cycle. PrismaModule/NotifyModule/
// RealtimeModule are @Global and don't need to be imported explicitly.
@Module({
  imports: [AuthModule, SyncModule],
  controllers: [ConflictsController],
  providers: [ConflictsService],
  exports: [ConflictsService],
})
export class ConflictsModule {}
