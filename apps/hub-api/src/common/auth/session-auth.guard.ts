import { Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service.js";
import { SESSION_TTL_MS } from "./session.constants.js";

// Ports legacy hub/src/lib/auth.js#requireUser: validates a `Bearer <token>`
// Authorization header against the sessions table and attaches req.user.
// Rejects missing/malformed header, unknown token, and expired/null-expiry
// sessions with a uniform 401 { error: "unauthorized" } body.
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.get("authorization") ?? "";

    if (!header.startsWith("Bearer ")) {
      throw new UnauthorizedException({ error: "unauthorized" });
    }
    const token = header.slice("Bearer ".length);

    const session = await this.prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });

    const now = Date.now();
    if (!session || session.expires_at == null || session.expires_at.getTime() <= now) {
      throw new UnauthorizedException({ error: "unauthorized" });
    }

    // Throttled sliding refresh: only write when the session is more than
    // halfway to expiry, so authenticated requests don't hammer the DB.
    const remainingMs = session.expires_at.getTime() - now;
    if (remainingMs < SESSION_TTL_MS / 2) {
      await this.prisma.session.update({
        where: { token },
        data: { expires_at: new Date(now + SESSION_TTL_MS) },
      });
    }

    (req as Request & { user?: unknown; sessionToken?: string }).user = session.user;
    (req as Request & { user?: unknown; sessionToken?: string }).sessionToken = token;

    return true;
  }
}
