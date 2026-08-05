import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import type { DashboardMetrics } from "@synchub/shared";

export interface ActivityEvent {
  id: number;
  user_id: number;
  machine_id: number | null;
  project_id: number | null;
  type: string;
  filename: string | null;
  bytes: number;
  latency_ms: number | null;
  created_at: string;
}

// SQLite raw-query rows. Prisma's sqlite driver may hand back COUNT/SUM
// aggregates as bigint depending on driver/value size, so every numeric
// field below is coerced with Number(...) before it reaches the DTO (which
// is validated against a zod schema expecting plain numbers).
interface ProjectsRow {
  n: bigint | number;
  syncing: bigint | number;
}
interface MachinesRow {
  n: bigint | number;
  online: bigint | number;
}
interface CountRow {
  n: bigint | number;
}
interface TodayRow {
  events: bigint | number;
  bytes: bigint | number;
}
interface LatRow {
  a: number | null;
}

// Ports legacy hub/src/models/stats.js#dashboardMetrics + hub/src/models/events.js#recent.
// The metrics queries use $queryRaw (parameterized via Prisma's tagged
// template, never string interpolation) because they lean on SQLite date
// functions and a DISTINCT project_id||'/'||filename concat trick that the
// Prisma query builder can't express directly.
//
// Prisma's sqlite driver stores DateTime columns as integer unix-epoch
// milliseconds (not the ISO-8601 TEXT the legacy better-sqlite3 schema
// used), so date('now')/datetime('now', ...) can't compare directly against
// created_at — it has to be converted first: date(created_at/1000,
// 'unixepoch') for "today", and strftime('%s','now','-7 days')*1000 for the
// trailing-7-day cutoff.
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async metrics(userId: number): Promise<DashboardMetrics> {
    const [
      [projectsRow],
      [machinesRow],
      [todayRow],
      [sessionsRow],
      [latRow],
      [unreadRow],
    ] = await Promise.all([
      this.prisma.$queryRaw<ProjectsRow[]>`
        SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN sync_mode != 'stopped' THEN 1 ELSE 0 END), 0) syncing
        FROM projects WHERE user_id = ${userId}
      `,
      this.prisma.$queryRaw<MachinesRow[]>`
        SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END), 0) online
        FROM machines WHERE user_id = ${userId}
      `,
      this.prisma.$queryRaw<TodayRow[]>`
        SELECT COUNT(*) events, COALESCE(SUM(bytes), 0) bytes FROM events
        WHERE user_id = ${userId} AND date(created_at / 1000, 'unixepoch') = date('now')
      `,
      this.prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(DISTINCT project_id || '/' || filename) n FROM events
        WHERE user_id = ${userId} AND filename IS NOT NULL AND type = 'push'
          AND date(created_at / 1000, 'unixepoch') = date('now')
      `,
      this.prisma.$queryRaw<LatRow[]>`
        SELECT AVG(latency_ms) a FROM events
        WHERE user_id = ${userId} AND latency_ms IS NOT NULL AND date(created_at / 1000, 'unixepoch') = date('now')
      `,
      this.prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*) n FROM notifications WHERE user_id = ${userId} AND read = 0
      `,
    ]);

    // Sync is last-write-wins: every push succeeds — there is no conflict or
    // failure outcome to track — so the success rate is always 100%.
    const syncSuccessRate = 100;

    const avgLatencyMs = latRow.a != null ? Math.round(Number(latRow.a)) : null;

    return {
      projects: { total: Number(projectsRow.n), syncing: Number(projectsRow.syncing) },
      machines: { total: Number(machinesRow.n), online: Number(machinesRow.online) },
      eventsToday: Number(todayRow.events),
      dataTransferredBytes: Number(todayRow.bytes),
      sessionsSyncedToday: Number(sessionsRow.n),
      syncSuccessRate,
      avgLatencyMs,
      unreadNotifications: Number(unreadRow.n),
    };
  }

  // Ports legacy hub/src/models/events.js#recent. Plain Prisma query builder
  // is sufficient here (no date functions), which keeps the result typed and
  // avoids any raw-row BigInt handling.
  async activity(userId: number, limit: number): Promise<ActivityEvent[]> {
    const rows = await this.prisma.event.findMany({
      where: { user_id: userId },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: limit,
    });

    return rows.map((e) => ({
      id: e.id,
      user_id: e.user_id,
      machine_id: e.machine_id,
      project_id: e.project_id,
      type: e.type,
      filename: e.filename,
      bytes: e.bytes,
      latency_ms: e.latency_ms,
      created_at: e.created_at.toISOString(),
    }));
  }
}
