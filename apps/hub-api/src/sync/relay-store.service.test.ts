import { createHash } from "node:crypto";
import { existsSync, readdirSync, rmSync, utimesSync } from "node:fs";
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
  // userId is always a numeric Prisma user id.
  const userId = 1;
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

    const userDir = join(TEST_DIR, String(userId), "blobs");
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
    const orphanUserId = 2;
    const a = svc.writeBlob(orphanUserId, '{"t":"a"}\n');
    // "orphan" here just means: written to the store with nothing in a DB
    // pointing at it — RelayStoreService has no notion of a DB, so simply
    // writing a second blob and never referencing it elsewhere models this.
    const orphan = svc.writeBlob(orphanUserId, '{"t":"orphan"}\n');

    const hashes = svc.listBlobHashes(orphanUserId);
    expect(hashes.sort()).toEqual([a, orphan].sort());
  });

  it("listBlobHashes returns an empty array for a user with no blobs", () => {
    expect(svc.listBlobHashes(999999)).toEqual([]);
  });

  it("gcOrphans deletes blobs not in the referenced set and returns the count deleted; referenced blobs survive", () => {
    const gcUserId = 3;
    const keep = svc.writeBlob(gcUserId, '{"t":"keep"}\n');
    const drop1 = svc.writeBlob(gcUserId, '{"t":"drop1"}\n');
    const drop2 = svc.writeBlob(gcUserId, '{"t":"drop2"}\n');

    // graceMs: 0 — this test is exercising the referenced/unreferenced
    // split, not the mtime grace window (covered separately below), and the
    // blobs above were just written so they'd otherwise fall inside the
    // default 5-minute grace and survive regardless of being unreferenced.
    const deleted = svc.gcOrphans(gcUserId, new Set([keep]), 0);

    expect(deleted).toBe(2);
    expect(svc.hasBlob(gcUserId, keep)).toBe(true);
    expect(svc.hasBlob(gcUserId, drop1)).toBe(false);
    expect(svc.hasBlob(gcUserId, drop2)).toBe(false);
  });

  it("gcOrphans skips a freshly-written orphan blob (within the mtime grace window): it survives and is excluded from the deleted count", () => {
    const gcUserId = 4;
    // Written just now, unreferenced, but a blob is written BEFORE the DB
    // row pointing at it commits — a fresh orphan may just be an in-flight
    // write whose commit hasn't landed yet, so GC must not touch it within
    // the grace window.
    const freshOrphan = svc.writeBlob(gcUserId, '{"t":"fresh-orphan"}\n');

    const deleted = svc.gcOrphans(gcUserId, new Set(), 5 * 60 * 1000);

    expect(deleted).toBe(0);
    expect(svc.hasBlob(gcUserId, freshOrphan)).toBe(true);
  });

  it("gcOrphans reclaims an orphan blob once its mtime is older than the grace window", () => {
    const gcUserId = 5;
    const staleOrphan = svc.writeBlob(gcUserId, '{"t":"stale-orphan"}\n');

    // Backdate the blob's mtime to well outside any reasonable grace window,
    // simulating a write whose DB row commit definitely isn't still in flight.
    const past = new Date(2020, 0, 1);
    const blobPath = join(TEST_DIR, String(gcUserId), "blobs", staleOrphan);
    utimesSync(blobPath, past, past);

    const deleted = svc.gcOrphans(gcUserId, new Set(), 5 * 60 * 1000);

    expect(deleted).toBe(1);
    expect(svc.hasBlob(gcUserId, staleOrphan)).toBe(false);
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
    const expectedPath = join(TEST_DIR, String(userId), "blobs", hash);
    expect(existsSync(expectedPath)).toBe(true);
  });

  it("rejects a non-64-hex hash (path-traversal attempt) instead of reading outside baseDir", () => {
    expect(() => svc.readBlob(userId, "../../etc/passwd")).toThrow();
    expect(() => svc.hasBlob(userId, "../../etc/passwd")).toThrow();
    expect(() => svc.removeBlob(userId, "../../etc/passwd")).toThrow();
  });

  it("readBlob returns null (not an error) for a well-formed but absent hash", () => {
    expect(svc.readBlob(userId, "a".repeat(64))).toBeNull();
  });
});
