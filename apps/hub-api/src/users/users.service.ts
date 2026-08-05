import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { CryptoService } from "../common/crypto/crypto.service.js";
import { SESSION_TTL_MS } from "../common/auth/session.constants.js";
import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
  ProfileUpdateRequest,
  SignupRequest,
  SignupResponse,
} from "@synchub/shared";

const PRISMA_UNIQUE_CONSTRAINT = "P2002";

// Ports legacy hub/src/routes/auth.js + hub/src/models/users.js + sessions.js.
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async signup(body: SignupRequest): Promise<SignupResponse> {
    const email = body.email.toLowerCase();
    const { hash, salt } = this.crypto.hashPassword(body.password);
    const name = normalizeName(body.name);

    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          email,
          password_hash: hash,
          password_salt: salt,
          name,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException({ error: "email exists", code: "email_exists" });
      }
      throw err;
    }

    const token = await this.createSession(user.id);
    return { token, user: { id: user.id, email: user.email, name: user.name ?? null } };
  }

  async login(body: LoginRequest): Promise<LoginResponse> {
    const email = body.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    const ok =
      user != null &&
      this.crypto.verifyPassword(body.password, user.password_hash, user.password_salt);
    if (!ok || !user) {
      throw new UnauthorizedException({ error: "invalid credentials", code: "invalid_credentials" });
    }

    const token = await this.createSession(user.id);
    return { token, user: { id: user.id, email: user.email } };
  }

  async logout(token: string): Promise<{ ok: true }> {
    await this.prisma.session.deleteMany({ where: { token } });
    return { ok: true };
  }

  me(user: User): MeResponse {
    return this.publicUser(user);
  }

  async updateProfile(userId: number, body: ProfileUpdateRequest): Promise<MeResponse> {
    const data: {
      name?: string | null;
      notify_webhook_url?: string | null;
      notify_sync?: number;
    } = {};

    if ("name" in body) data.name = normalizeName(body.name);
    if ("notify_webhook_url" in body) data.notify_webhook_url = body.notify_webhook_url ?? null;
    if ("notify_sync" in body) data.notify_sync = body.notify_sync ? 1 : 0;

    const user = await this.prisma.user.update({ where: { id: userId }, data });
    return this.publicUser(user);
  }

  async setWebhook(
    userId: number,
    url: string | null | undefined,
  ): Promise<{ notify_webhook_url: string | null }> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { notify_webhook_url: url ?? null },
    });
    return { notify_webhook_url: user.notify_webhook_url };
  }

  // Legacy sessions.createSession, with an added expiry (legacy sessions never expired).
  async createSession(userId: number): Promise<string> {
    const token = this.crypto.randomToken();
    await this.prisma.session.create({
      data: {
        token,
        user_id: userId,
        expires_at: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return token;
  }

  publicUser(user: User): MeResponse {
    return {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      notify_webhook_url: user.notify_webhook_url,
      notify_sync: user.notify_sync !== 0,
    };
  }
}

// Trim, cap at 120 chars, and fold empty string down to null — matches
// legacy `(name ?? "").toString().trim().slice(0, 120)` plus its `|| null` fallback.
function normalizeName(name: string | null | undefined): string | null {
  const trimmed = (name ?? "").toString().trim().slice(0, 120);
  return trimmed || null;
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PRISMA_UNIQUE_CONSTRAINT
  );
}
