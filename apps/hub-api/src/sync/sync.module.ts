import { Module } from "@nestjs/common";
import { SyncController } from "./sync.controller.js";
import { SyncService } from "./sync.service.js";
import { RelayStoreService } from "./relay-store.service.js";
import { RelayGcService } from "./relay-gc.service.js";
import { AuthModule } from "../common/auth/auth.module.js";

// PrismaModule and RealtimeModule are @Global, so they don't need to be
// imported here to make PrismaService / REALTIME_PORT injectable into
// SyncService.
@Module({
  imports: [AuthModule],
  controllers: [SyncController],
  providers: [SyncService, RelayStoreService, RelayGcService],
  exports: [SyncService, RelayStoreService, RelayGcService],
})
export class SyncModule {}
