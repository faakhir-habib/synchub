import { Injectable } from "@nestjs/common";
import { scryptSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";

@Injectable()
export class CryptoService {
  hashContent(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
  }

  hashPassword(
    password: string,
    salt: string = randomBytes(16).toString("hex"),
  ): { hash: string; salt: string } {
    const hash = scryptSync(password, salt, 64).toString("hex");
    return { hash, salt };
  }

  verifyPassword(password: string, hash: string, salt: string): boolean {
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString("base64url");
  }
}
