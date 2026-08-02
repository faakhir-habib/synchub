import { Global, Module } from "@nestjs/common";
import { RealtimeGateway } from "./realtime.gateway.js";
import { REALTIME_PORT } from "./realtime.port.js";

// Phase 2c: the realtime broker is the real WebSocket gateway. `RealtimeGateway`
// is provided as a class provider AND bound to the REALTIME_PORT token via
// `useExisting` so both the token and direct injection resolve to the SAME
// singleton instance — critical since the gateway owns the heartbeat timer and
// the agent/user socket registries, and those must not be duplicated. Global so
// any module (the sync engine, notifications) can inject REALTIME_PORT without
// importing this module explicitly.
@Global()
@Module({
  providers: [RealtimeGateway, { provide: REALTIME_PORT, useExisting: RealtimeGateway }],
  exports: [REALTIME_PORT, RealtimeGateway],
})
export class RealtimeModule {}
