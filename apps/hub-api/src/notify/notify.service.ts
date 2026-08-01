import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Notification } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { assertPublicHttpUrl } from "../common/net/ssrf.js";
import { REALTIME_PORT } from "../realtime/realtime.port.js";
import type { RealtimePort } from "../realtime/realtime.port.js";

export interface NotifyParams {
  user_id: number;
  type: string;
  title: string;
  body?: string | null;
}

const WEBHOOK_TIMEOUT_MS = 5000;

// Ports legacy hub/src/lib/notify.js#notifyUser: load the user, apply the
// notification-preference gate, insert the row, then fan out live over WS
// and (best-effort, SSRF-guarded) to the user's personal webhook.
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
  ) {}

  async notify({ user_id, type, title, body = null }: NotifyParams): Promise<Notification | null> {
    const user = await this.prisma.user.findUnique({ where: { id: user_id } });
    if (!user) return null;

    // Respect the user's notification preferences — ported exactly from
    // hub/src/lib/notify.js:9-10. Only "conflict" and "sync" are gated by
    // their matching preference; every other type always proceeds.
    if (type === "conflict" && user.notify_conflicts === 0) return null;
    if (type === "sync" && user.notify_sync === 0) return null;

    const note = await this.prisma.notification.create({
      data: { user_id, type, title, body },
    });

    // Live push to the user's browsers. Fire-and-forget: RealtimePort methods
    // are void/best-effort by contract (see realtime.port.ts) and the
    // gateway degrades gracefully when the user has no open sockets.
    try {
      this.realtime.pushNotification(user_id, { type, title, body });
    } catch (err) {
      this.logger.warn(
        `pushNotification failed (user_id=${user_id}, type=${type}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Best-effort relay to the user's personal webhook, mirroring legacy
    // hub/src/lib/notify.js's fetch(...).catch(() => {}) — SSRF-guarded and
    // fully try/caught so a bad/blocked/unreachable webhook can never affect
    // the already-committed notification row or throw out of notify().
    if (user.notify_webhook_url) {
      void this.relayWebhook(user.notify_webhook_url, { type, title, body });
    }

    return note;
  }

  private async relayWebhook(
    url: string,
    payload: { type: string; title: string; body?: string | null },
  ): Promise<void> {
    try {
      await assertPublicHttpUrl(url);
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, at: new Date().toISOString() }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        redirect: "error",
      });
    } catch (err) {
      this.logger.warn(
        `notify webhook failed (url=${url}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
