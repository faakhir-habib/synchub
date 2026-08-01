import { Injectable } from "@nestjs/common";
import type { Notification } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";

export interface NotifyParams {
  user_id: number;
  type: string;
  title: string;
  body?: string | null;
}

// Ports legacy hub/src/lib/notify.js#notifyUser. This is the CORE only: load
// the user, apply the notification-preference gate, and insert the row.
//
// The WS-push and per-user webhook relay from the legacy implementation are
// deliberately NOT ported here — they land in Phase 2c as additive hooks
// (see the TODOs below) that must not change this method's signature or
// return type.
@Injectable()
export class NotifyService {
  constructor(private readonly prisma: PrismaService) {}

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

    // TODO(2c): this.realtime?.pushNotification(user_id, note);
    // TODO(2c): fire SSRF-guarded webhook to user.notify_webhook_url (best-effort,
    // must never block or throw — mirrors the legacy fetch(...).catch(() => {})).

    return note;
  }
}
