import { createHash } from "node:crypto";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RelayStoreService } from "./relay-store.service.js";

// Test-scoped temp dir (fixed name, not Math.random/Date.now-derived) so
// RELAY_STORE_DIR can be pointed at an isolated location for this suite.
const TEST_DIR = join(tmpdir(), "synchub-relay-store-service-test");

// RelayStoreService reads process.env.RELAY_STORE_DIR in its constructor
// (not at import time), so it's enough to set the env var before we
// construct the instance in beforeAll below.
process.env.RELAY_STORE_DIR = TEST_DIR;

describe("RelayStoreService", () => {
  const userId = "user-1";
  let svc: InstanceType<typeof RelayStoreService>;

  beforeAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    svc = new RelayStoreService();
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("writeBlob returns the sha-256 hex of the content and creates a readable file", () => {
    const content = '{"t":1}\n';
    const hash = svc.writeBlob(userId, content);
    const expected = createHash("sha256").update(content, "utf8").digest("hex");
    expect(hash).toBe(expected);
    expect(svc.hasBlob(userId, hash)).toBe(true);
    expect(svc.readBlob(userId, hash)).toBe(content);
  });

  it("readBlob returns null for an absent hash", () => {
    expect(svc.readBlob(userId, "0".repeat(64))).toBeNull();
  });

  it("writing the same content twice is idempotent: same hash, no throw, still one file", () => {
    const content = '{"t":"dup-check"}\n';
    const h1 = svc.writeBlob(userId, content);
    expect(() => svc.writeBlob(userId, content)).not.toThrow();
    const h2 = svc.writeBlob(userId, content);
    expect(h2).toBe(h1);

    const userDir = join(TEST_DIR, userId, "blobs");
    const matches = readdirSync(userDir).filter((n) => n === h1);
    expect(matches).toHaveLength(1);
  });

  it("hasBlob is true after write and false for an unwritten hash", () => {
    const content = '{"t":"has-blob-check"}\n';
    const hash = svc.writeBlob(userId, content);
    expect(svc.hasBlob(userId, hash)).toBe(true);
    expect(svc.hasBlob(userId, "f".repeat(64))).toBe(false);
  });

  it("removeBlob deletes the blob; no-op if absent", () => {
    const content = '{"t":"remove-check"}\n';
    const hash = svc.writeBlob(userId, content);
    expect(svc.hasBlob(userId, hash)).toBe(true);

    svc.removeBlob(userId, hash);
    expect(svc.hasBlob(userId, hash)).toBe(false);

    // no-op, must not throw
    expect(() => svc.removeBlob(userId, hash)).not.toThrow();
  });

  it("listBlobHashes includes orphan blobs written with no DB pointer (simulated crash orphan)", () => {
    const orphanUserId = "user-orphan-list";
    const a = svc.writeBlob(orphanUserId, '{"t":"a"}\n');
    // "orphan" here just means: written to the store with nothing in a DB
    // pointing at it — RelayStoreService has no notion of a DB, so simply
    // writing a second blob and never referencing it elsewhere models this.
    const orphan = svc.writeBlob(orphanUserId, '{"t":"orphan"}\n');

    const hashes = svc.listBlobHashes(orphanUserId);
    expect(hashes.sort()).toEqual([a, orphan].sort());
  });

  it("listBlobHashes returns an empty array for a user with no blobs", () => {
    expect(svc.listBlobHashes("user-never-written")).toEqual([]);
  });

  it("gcOrphans deletes blobs not in the referenced set and returns the count deleted; referenced blobs survive", () => {
    const gcUserId = "user-gc";
    const keep = svc.writeBlob(gcUserId, '{"t":"keep"}\n');
    const drop1 = svc.writeBlob(gcUserId, '{"t":"drop1"}\n');
    const drop2 = svc.writeBlob(gcUserId, '{"t":"drop2"}\n');

    const deleted = svc.gcOrphans(gcUserId, new Set([keep]));

    expect(deleted).toBe(2);
    expect(svc.hasBlob(gcUserId, keep)).toBe(true);
    expect(svc.hasBlob(gcUserId, drop1)).toBe(false);
    expect(svc.hasBlob(gcUserId, drop2)).toBe(false);
  });

  it("content integrity: returned hash matches an independently computed sha-256", () => {
    const content = "The quick brown fox jumps over the lazy dog";
    const hash = svc.writeBlob(userId, content);
    const expected = createHash("sha256").update(content, "utf8").digest("hex");
    expect(hash).toBe(expected);
  });

  it("stores blobs at a path derived from the hash, under <baseDir>/<userId>/blobs/<hash>", () => {
    const content = '{"t":"path-check"}\n';
    const hash = svc.writeBlob(userId, content);
    const expectedPath = join(TEST_DIR, userId, "blobs", hash);
    expect(existsSync(expectedPath)).toBe(true);
  });
});
