import { describe, expect, it } from "vitest";
import { CryptoService } from "./crypto.service.js";

describe("CryptoService", () => {
  const service = new CryptoService();

  describe("hashPassword / verifyPassword", () => {
    it("returns a hash and salt as non-empty hex strings", () => {
      const { hash, salt } = service.hashPassword("pw");
      expect(hash).toMatch(/^[0-9a-f]+$/);
      expect(salt).toMatch(/^[0-9a-f]+$/);
      expect(hash.length).toBeGreaterThan(0);
      expect(salt.length).toBeGreaterThan(0);
    });

    it("uses a different salt across calls", () => {
      const a = service.hashPassword("pw");
      const b = service.hashPassword("pw");
      expect(a.salt).not.toBe(b.salt);
      expect(a.hash).not.toBe(b.hash);
    });

    it("verifies the correct password as true", () => {
      const { hash, salt } = service.hashPassword("pw");
      expect(service.verifyPassword("pw", hash, salt)).toBe(true);
    });

    it("verifies an incorrect password as false", () => {
      const { hash, salt } = service.hashPassword("pw");
      expect(service.verifyPassword("wrong", hash, salt)).toBe(false);
    });

    it("returns false (does not throw) when the stored hash has a different byte length", () => {
      const { salt } = service.hashPassword("pw");
      const garbageHash = "ab"; // 1 byte, definitely shorter than the 64-byte scrypt output
      expect(() => service.verifyPassword("pw", garbageHash, salt)).not.toThrow();
      expect(service.verifyPassword("pw", garbageHash, salt)).toBe(false);
    });
  });

  describe("hashContent", () => {
    it("returns the known SHA-256 hex digest of 'x'", () => {
      expect(service.hashContent("x")).toBe(
        "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
      );
    });
  });

  describe("randomToken", () => {
    it("returns a base64url string", () => {
      const token = service.randomToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("differs across calls", () => {
      const a = service.randomToken();
      const b = service.randomToken();
      expect(a).not.toBe(b);
    });

    it("produces a shorter token for fewer bytes", () => {
      const short = service.randomToken(8);
      const long = service.randomToken(32);
      expect(short.length).toBeLessThan(long.length);
    });
  });
});
