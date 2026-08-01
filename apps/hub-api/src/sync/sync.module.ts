import { Module } from "@nestjs/common";
import { SyncController } from "./sync.controller.js";
import { SyncService } from "./sync.service.js";
import { RelayStoreService } from "./relay-store.service.js";
import { AuthModule } from "../common/auth/auth.module.js";

// PrismaModule is @Global, so it doesn't need to be imported here.
@Module({
  imports: [AuthModule],
  controllers: [SyncController],
  providers: [SyncService, RelayStoreService],
  exports: [SyncService, RelayStoreService],
})
export class SyncModule {}
