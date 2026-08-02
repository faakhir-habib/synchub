import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

// Content-addressed blob store: <baseDir>/<userId>/blobs/<sha256-hex>.
//
// This replaces the legacy flat-file relay store (hub/src/lib/relayStore.js,
// which wrote content directly to a name-derived path with a single
// writeFileSync). That design has a crash window: if the process dies
// mid-write, the file on disk can be left truncated/partial while a DB row
// still claims it holds a particular version — content and the DB's record
// of it can diverge silently.
//
// Content-addressing removes that window structurally. The blob's on-disk
// path IS its sha-256 hash, so:
//   - a write is: hash the content, write to a temp file in the same
//     directory, fsync it, then atomically rename it into place at
//     <hash>. Rename is atomic on POSIX and NTFS, so any observer only ever
//     sees "no file" or "the complete, correctly-named file" — never a
//     partial one.
//   - the DB (file_state.hash / conflict.candidate_hash) only ever stores a
//     hash pointer, never raw content. A crash between "blob written" and
//     "DB row committed" just leaves an orphan blob on disk (harmless,
//     later swept by gcOrphans) — the DB still points at whatever hash it
//     last committed, and that blob is guaranteed to still exist and still
//     match its hash. Content and hash can never diverge.
//   - writes are naturally idempotent and de-duplicated: identical content
//     always hashes to the same path, so re-writing the same content is a
//     no-op check (hasBlob) rather than a fresh write.
@Injectable()
export class RelayStoreService {
  private readonly baseDir: string;
  // Monotonic in-process counter to disambiguate concurrent temp files for
  // the same hash, without resorting to Math.random()/Date.now().
  private tmpCounter = 0;

  constructor() {
    this.baseDir = process.env.RELAY_STORE_DIR ?? join(process.cwd(), "data", "relay-store");
  }

  private hashOf(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
  }

  // Blob paths are built from caller-supplied hashes (endpoints will pass a
  // request param straight through). Enforce the sha-256 hex shape *before*
  // it's ever joined into a filesystem path, so a value like
  // "../../etc/passwd" is rejected structurally rather than relying on
  // callers to sanitize.
  private assertHash(hash: string): void {
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw new BadRequestException(`invalid blob hash: ${JSON.stringify(hash)}`);
    }
  }

  private userDir(userId: number): string {
    return join(this.baseDir, String(userId), "blobs");
  }

  private blobPath(userId: number, hash: string): string {
    return join(this.userDir(userId), hash);
  }

  /** Hash `content`, store it write-once at the content-addressed path, and return the hash. */
  writeBlob(userId: number, content: string): string {
    const hash = this.hashOf(content);
    this.assertHash(hash); // sanity check on our own computed hash
    if (this.hasBlob(userId, hash)) return hash;

    const dir = this.userDir(userId);
    mkdirSync(dir, { recursive: true });

    const tmpPath = join(dir, `${hash}.${this.tmpCounter++}.tmp`);
    const finalPath = this.blobPath(userId, hash);

    try {
      const fd = openSync(tmpPath, "w");
      try {
        writeSync(fd, content, null, "utf8");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }

      renameSync(tmpPath, finalPath);
    } catch (err) {
      // Any failure during the write phase (open/write/fsync/rename — e.g.
      // ENOSPC disk-full, which is exactly the case this store must survive)
      // must not leak the temp file: listBlobHashes filters *.tmp names, so
      // an orphaned temp file would never be reclaimed by gcOrphans.
      try {
        rmSync(tmpPath, { force: true });
      } catch {
        // best-effort cleanup; ignore
      }
      throw err;
    }

    // Best-effort directory fsync so the rename is durable across a crash.
    // Directory fsync is not supported on all platforms (notably Windows,
    // where opening a directory or fsyncSync-ing its fd throws EISDIR/EPERM)
    // — swallow failures there, it's a durability nicety, not correctness.
    try {
      const dirFd = openSync(dir, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      // best-effort; platform doesn't support directory fsync
    }

    return hash;
  }

  /** Read blob content by hash, or null if it doesn't exist. */
  readBlob(userId: number, hash: string): string | null {
    this.assertHash(hash);
    const p = this.blobPath(userId, hash);
    try {
      return readFileSync(p, "utf8");
    } catch (err) {
      // Guard against a TOCTOU race with a concurrent removeBlob/gcOrphans:
      // treat "gone by the time we read it" the same as "never existed".
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  hasBlob(userId: number, hash: string): boolean {
    this.assertHash(hash);
    return existsSync(this.blobPath(userId, hash));
  }

  /** Delete a blob if present; no-op if absent. */
  removeBlob(userId: number, hash: string): void {
    this.assertHash(hash);
    const p = this.blobPath(userId, hash);
    if (existsSync(p)) rmSync(p);
  }

  /** All hashes currently stored for `userId` (excludes in-flight *.tmp files). */
  listBlobHashes(userId: number): string[] {
    const dir = this.userDir(userId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((name) => !name.endsWith(".tmp"));
  }

  /**
   * Delete every stored blob for `userId` whose hash is not in `referenced`
   * (e.g. not pointed at by any file_state.hash / conflict.candidate_hash
   * row). Returns the number of blobs deleted.
   *
   * Blobs are written BEFORE the DB row that references them commits (that
   * ordering is what makes writeBlob's crash-safety guarantee possible — see
   * the file header). That leaves a window, between "blob written" and "DB
   * row committed", during which a blob is genuinely unreferenced yet is
   * about to become referenced any moment. A GC sweep that runs in that
   * window would delete it out from under the still-in-flight write,
   * leaving the DB row that commits a moment later pointing at nothing.
   *
   * `graceMs` guards that window: any orphan candidate whose file mtime is
   * more recent than `graceMs` is skipped this sweep (it may still be
   * in-flight) and picked up by a later sweep once it's actually stale.
   */
  gcOrphans(userId: number, referenced: Set<string>, graceMs = 5 * 60 * 1000): number {
    const now = Date.now();
    let deleted = 0;
    for (const hash of this.listBlobHashes(userId)) {
      if (referenced.has(hash)) continue;

      const p = this.blobPath(userId, hash);
      try {
        const stat = statSync(p);
        if (now - stat.mtimeMs < graceMs) continue; // possibly in-flight; skip this sweep
      } catch (err) {
        // Vanished between listBlobHashes and stat (e.g. a concurrent GC
        // pass, or the write's own tmp-file cleanup): nothing to delete.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }

      this.removeBlob(userId, hash);
      deleted++;
    }
    return deleted;
  }
}
