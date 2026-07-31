import { createHash } from "node:crypto";

// Must match the Hub's hashContent (sha256 of UTF-8 content).
export const hashContent = (content) => createHash("sha256").update(content, "utf8").digest("hex");
