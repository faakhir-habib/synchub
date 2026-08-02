import { createHash } from "node:crypto";

/** Must match the Hub's hashContent (sha256 of UTF-8 content, hex digest). */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
