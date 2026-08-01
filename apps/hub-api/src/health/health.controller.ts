import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@synchub/shared";

@Controller("health")
export class HealthController {
  @Get()
  get(): HealthResponse {
    return { status: "ok", version: "0.1.0", db: "up" };
  }
}
