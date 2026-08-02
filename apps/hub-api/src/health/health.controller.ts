import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@synchub/shared";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(): Promise<HealthResponse> {
    let db: "up" | "down" = "up";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = "down";
    }
    return { status: "ok", version: "0.1.0", db };
  }
}
