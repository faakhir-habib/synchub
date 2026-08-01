import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Machine } from "@prisma/client";
import { randomInt } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { CryptoService } from "../common/crypto/crypto.service.js";
import type {
  MachineCreateRequest,
  MachineWithToken,
  PairCreateResponse,
  PairRedeemRequest,
  PairRedeemResponse,
  PublicMachine,
} from "@synchub/shared";

const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const DEFAULT_PAIR_TTL_SECONDS = 600;

function sixCharCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return s;
}

// Ports legacy hub/src/routes/machines.js + hub/src/models/machines.js.
@Injectable()
export class MachinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async listForUser(userId: number): Promise<PublicMachine[]> {
    const machines = await this.prisma.machine.findMany({
      where: { user_id: userId },
      orderBy: { created_at: "asc" },
    });
    return machines.map((m) => this.publicMachine(m));
  }

  async create(
    userId: number,
    body: MachineCreateRequest,
    lastIp: string | null,
  ): Promise<MachineWithToken> {
    const token = this.crypto.randomToken();
    const machine = await this.prisma.machine.create({
      data: {
        user_id: userId,
        name: body.name,
        token,
        os: body.os ?? null,
        os_version: body.os_version ?? null,
        label: body.label ?? null,
        last_ip: lastIp,
      },
    });
    return { ...this.publicMachine(machine), token: machine.token };
  }

  async remove(userId: number, id: number): Promise<{ ok: true }> {
    const result = await this.prisma.machine.deleteMany({ where: { id, user_id: userId } });
    if (result.count === 0) {
      throw new NotFoundException({ error: "not found" });
    }
    return { ok: true };
  }

  async createPairingCode(
    userId: number,
    ttlSeconds: number = DEFAULT_PAIR_TTL_SECONDS,
  ): Promise<PairCreateResponse> {
    const code = sixCharCode();
    await this.prisma.pairingCode.create({
      data: {
        code,
        user_id: userId,
        expires_at: new Date(Date.now() + ttlSeconds * 1000),
      },
    });
    return { code, expires_in: ttlSeconds };
  }

  // Redeems a valid, unexpired, unconsumed code -> creates a machine under the
  // code's owner, then consumes the code so it can't be redeemed again.
  async redeemPairingCode(
    body: PairRedeemRequest,
    lastIp: string | null,
  ): Promise<PairRedeemResponse> {
    const row = await this.prisma.pairingCode.findFirst({
      where: { code: body.code, machine_id: null, expires_at: { gt: new Date() } },
    });
    if (!row) {
      throw new BadRequestException({ error: "invalid or expired code", code: "invalid_code" });
    }

    const machine = await this.prisma.machine.create({
      data: {
        user_id: row.user_id,
        name: body.name || "New machine",
        token: this.crypto.randomToken(),
        os: body.os ?? null,
        os_version: body.os_version ?? null,
        label: body.label ?? null,
        agent_version: body.agent_version ?? null,
        last_ip: lastIp,
      },
    });

    await this.prisma.pairingCode.update({
      where: { code: row.code },
      data: { machine_id: machine.id },
    });

    return { machineToken: machine.token, machineId: machine.id };
  }

  // Strips the secret token (and user_id) from a machine row for list/detail responses.
  publicMachine(m: Machine): PublicMachine {
    return {
      id: m.id,
      name: m.name,
      os: m.os,
      os_version: m.os_version,
      label: m.label,
      agent_version: m.agent_version,
      last_ip: m.last_ip,
      status: m.status as PublicMachine["status"],
      last_seen_at: m.last_seen_at ? m.last_seen_at.toISOString() : null,
      created_at: m.created_at.toISOString(),
    };
  }
}
