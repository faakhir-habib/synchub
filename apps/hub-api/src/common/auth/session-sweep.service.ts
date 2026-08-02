import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service.js";

// Periodically purges expired session rows so the `sessions` table doesn't
// grow unbounded. Only rows with a non-null `expires_at` that has already
// passed are deleted; rows with `expires_at = null` are intentionally left
// alone here — SessionAuthGuard already treats a null expiry as "always
// rejected" (see session-auth.guard.ts), so they're harmless dead weight
// rather than a security concern, and sweeping them is out of scope for
// this cleanup job.
@Injectable()
export class SessionSweepService {
  private readonly logger = new Logger(SessionSweepService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweepExpiredSessions(): Promise<void> {
    const { count } = await this.prisma.session.deleteMany({
      where: { expires_at: { not: null, lte: new Date() } },
    });
    this.logger.log(`Swept ${count} expired session(s).`);
  }
}
