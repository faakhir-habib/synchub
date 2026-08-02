import { Global, Module } from "@nestjs/common";
import { NotifyService } from "./notify.service.js";

// @Global so Phase 2b's sync handlers (and any other module) can inject
// NotifyService without importing NotifyModule directly.
@Global()
@Module({
  providers: [NotifyService],
  exports: [NotifyService],
})
export class NotifyModule {}
