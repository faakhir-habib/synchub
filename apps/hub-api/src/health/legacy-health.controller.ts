import { Controller, Get } from "@nestjs/common";

// Legacy parity: the old Express hub served `GET /api/health` -> { ok: true }.
//
// This can't just be `@Controller("health")` prefixed by setGlobalPrefix: Nest
// matches setGlobalPrefix's `exclude` list against each controller's *raw*
// (pre-prefix) route path, and the DB-probe HealthController below already
// registers the raw path "health" excluded from the prefix so it serves
// unprefixed /health. If this controller also declared @Controller("health"),
// its raw path would collide with that same exclude entry and it would *also*
// end up served (un-prefixed) at /health instead of /api/health, shadowing or
// clashing with the DB probe. So this controller's raw path is the literal
// "api/health", and main.ts excludes that exact literal from prefixing too
// (prepending "api" again would otherwise yield /api/api/health).
@Controller("api/health")
export class LegacyHealthController {
  @Get()
  get(): { ok: true } {
    return { ok: true };
  }
}
