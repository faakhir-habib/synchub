import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service.js";
import { RelayStoreService } from "./relay-store.service.js";

// Orphan-blob GC: a blob written to the relay store outlives the DB row that
// referenced it whenever a candidate/canonical write loses a race (a newer
// push supersedes it) or a conflict is resolved (the losing candidate's blob
// is no longer pointed at by anything). Those orphans are harmless but
// accumulate forever without a sweep — this service reclaims them per-user.
@Injectable()
export class RelayGcService {
  private readonly logger = new Logger(RelayGcService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly relay: RelayStoreService,
  ) {}

  // Gather every blob hash still referenced for `userId` — the canonical
  // hash of every file_state row in the user's projects, plus the candidate
  // hash of every still-OPEN conflict (a resolved conflict's candidate is no
  // longer referenced by anything and is intentionally reclaimable) — and
  // delete every stored blob not in that set.
  async gcUser(userId: number): Promise<number> {
    const referenced = new Set<string>();

    const fileStates = await this.prisma.fileState.findMany({
      where: { project: { user_id: userId } },
      select: { hash: true },
    });
    for (const { hash } of fileStates) referenced.add(hash);

    const openConflicts = await this.prisma.conflict.findMany({
      where: { status: "open", project: { user_id: userId } },
      select: { candidate_hash: true },
    });
    for (const { candidate_hash } of openConflicts) referenced.add(candidate_hash);

    return this.relay.gcOrphans(userId, referenced);
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async sweepAll(): Promise<void> {
    const users = await this.prisma.user.findMany({ select: { id: true } });
    let totalReclaimed = 0;
    for (const u of users) {
      try {
        totalReclaimed += await this.gcUser(u.id);
      } catch (err) {
        // One user's GC failing (e.g. a transient FS error) must not abort
        // the sweep for everyone else.
        this.logger.error(`orphan-blob GC failed for user ${u.id}`, err as Error);
      }
    }
    this.logger.log(`orphan-blob GC swept ${users.length} user(s), reclaimed ${totalReclaimed} blob(s)`);
  }
}
