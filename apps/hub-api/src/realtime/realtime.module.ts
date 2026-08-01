import { Global, Module } from "@nestjs/common";
import { NoopRealtime, REALTIME_PORT } from "./realtime.port.js";

// Phase 2b: the realtime broker is a no-op. Phase 2c replaces `useClass` with the
// real WebSocket gateway. Global so any module (the sync engine, notifications)
// can inject REALTIME_PORT without importing this module explicitly.
@Global()
@Module({
  providers: [{ provide: REALTIME_PORT, useClass: NoopRealtime }],
  exports: [REALTIME_PORT],
})
export class RealtimeModule {}
