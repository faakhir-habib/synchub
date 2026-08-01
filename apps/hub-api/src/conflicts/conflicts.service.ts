import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

// A conflict row plus the alias of the project it belongs to, for the
// cross-project "all my open conflicts" view.
export interface ConflictWithProjectAlias {
  id: number;
  project_id: number;
  filename: string;
  machine_id: number | null;
  candidate_hash: string;
  auto_merged: boolean;
  status: string;
  created_at: string;
  resolved_at: string | null;
  project_alias: string;
}

// Ports legacy hub/src/models/conflicts.js#listOpenForUser.
@Injectable()
export class ConflictsService {
  constructor(private readonly prisma: PrismaService) {}

  async listOpenForUser(userId: number): Promise<ConflictWithProjectAlias[]> {
    const rows = await this.prisma.conflict.findMany({
      where: { status: "open", project: { user_id: userId } },
      include: { project: { select: { alias: true } } },
      orderBy: { created_at: "desc" },
    });

    return rows.map((c) => ({
      id: c.id,
      project_id: c.project_id,
      filename: c.filename,
      machine_id: c.machine_id,
      candidate_hash: c.candidate_hash,
      auto_merged: c.auto_merged !== 0,
      status: c.status,
      created_at: c.created_at.toISOString(),
      resolved_at: c.resolved_at ? c.resolved_at.toISOString() : null,
      project_alias: c.project.alias,
    }));
  }
}
