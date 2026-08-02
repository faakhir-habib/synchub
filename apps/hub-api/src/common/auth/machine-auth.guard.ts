import { Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service.js";

// Ports legacy hub/src/lib/auth.js#requireMachine: validates the
// X-Machine-Token header against the machines table and attaches req.machine.
@Injectable()
export class MachineAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.get("x-machine-token");

    const machine = token ? await this.prisma.machine.findUnique({ where: { token } }) : null;

    if (!machine) {
      throw new UnauthorizedException({ error: "unauthorized" });
    }

    (req as Request & { machine?: unknown }).machine = machine;

    return true;
  }
}
