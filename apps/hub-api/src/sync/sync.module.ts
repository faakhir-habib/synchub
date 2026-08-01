import { Module } from "@nestjs/common";
import { SyncController } from "./sync.controller.js";
import { SyncService } from "./sync.service.js";
import { RelayStoreService } from "./relay-store.service.js";
import { MergeService } from "./merge.service.js";
import { AuthModule } from "../common/auth/auth.module.js";

// PrismaModule, NotifyModule and RealtimeModule are all @Global, so they
// don't need to be imported here to make NotifyService / REALTIME_PORT
// injectable into SyncService.
@Module({
  imports: [AuthModule],
  controllers: [SyncController],
  providers: [SyncService, RelayStoreService, MergeService],
  exports: [SyncService, RelayStoreService],
})
export class SyncModule {}
