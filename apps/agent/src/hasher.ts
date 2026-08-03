import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** Must match the Hub's hashContent (sha256 of UTF-8 content, hex digest). */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Streaming equivalent of `hashContent` for a file on disk: sha256 of the
 * file's raw bytes, hex digest. For a UTF-8 file (what the agent syncs) those
 * raw bytes ARE the UTF-8 encoding of its text, so this yields the identical
 * digest to `hashContent(await readFile(path, "utf8"))` — but at constant
 * memory (chunked), never holding the whole file (or, across a directory
 * scan, every file at once). This is what keeps reconcile from spiking heap
 * proportional to total transcript size.
 */
export function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
