import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import type { NotificationsSummary } from "@synchub/shared";

const DEFAULT_LIMIT = 50;

// Ports legacy hub/src/models/notifications.js + hub/src/routes/notifications.js.
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(
    userId: number,
    limit: number = DEFAULT_LIMIT,
  ): Promise<NotificationsSummary["items"]> {
    const rows = await this.prisma.notification.findMany({
      where: { user_id: userId },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      read: n.read !== 0,
      created_at: n.created_at.toISOString(),
    }));
  }

  async unreadCount(userId: number): Promise<number> {
    return this.prisma.notification.count({ where: { user_id: userId, read: 0 } });
  }

  async summary(userId: number, limit: number = DEFAULT_LIMIT): Promise<NotificationsSummary> {
    const [unread, items] = await Promise.all([
      this.unreadCount(userId),
      this.listForUser(userId, limit),
    ]);
    return { unread, items };
  }

  async markRead(userId: number, id: number): Promise<{ ok: true }> {
    const result = await this.prisma.notification.updateMany({
      where: { id, user_id: userId },
      data: { read: 1 },
    });
    if (result.count === 0) {
      throw new NotFoundException({ error: "not found" });
    }
    return { ok: true };
  }

  async markAllRead(userId: number): Promise<{ ok: true }> {
    await this.prisma.notification.updateMany({
      where: { user_id: userId },
      data: { read: 1 },
    });
    return { ok: true };
  }
}
