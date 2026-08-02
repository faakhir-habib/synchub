import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl, type LookupFn } from "./ssrf.js";

// Hermetic DNS stand-in: never touches real DNS. Each test supplies exactly
// the resolution behavior it needs via the injected `lookupFn` param.
function stubLookup(map: Record<string, string[]>): LookupFn {
  return async (hostname: string) => {
    const addresses = map[hostname];
    if (!addresses) throw new Error(`stubLookup: no entry for ${hostname}`);
    return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
}

describe("assertPublicHttpUrl", () => {
  it("resolves for a public hostname (mocked DNS -> public IP)", async () => {
    const lookup = stubLookup({ "example.com": ["93.184.216.34"] });
    await expect(assertPublicHttpUrl("https://example.com", lookup)).resolves.toBeUndefined();
  });

  it("throws for a loopback literal IPv4 (127.0.0.1)", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1")).rejects.toThrow();
  });

  it("throws for the cloud metadata IP (169.254.169.254)", async () => {
    await expect(assertPublicHttpUrl("http://169.254.169.254")).rejects.toThrow();
  });

  it("throws for a private 10/8 literal (10.0.0.5)", async () => {
    await expect(assertPublicHttpUrl("http://10.0.0.5")).rejects.toThrow();
  });

  it("throws for a private 192.168/16 literal (192.168.1.1)", async () => {
    await expect(assertPublicHttpUrl("http://192.168.1.1")).rejects.toThrow();
  });

  it("throws for the IPv6 loopback literal ([::1])", async () => {
    await expect(assertPublicHttpUrl("http://[::1]")).rejects.toThrow();
  });

  it("throws when a hostname resolves (mocked) to a private IP — DNS-rebinding defense", async () => {
    const lookup = stubLookup({ "evil.example.com": ["10.1.2.3"] });
    await expect(assertPublicHttpUrl("http://evil.example.com", lookup)).rejects.toThrow();
  });

  it("throws for a non-http(s) scheme (ftp:)", async () => {
    await expect(assertPublicHttpUrl("ftp://x")).rejects.toThrow();
  });

  it("throws for a file: URL", async () => {
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow();
  });

  it("fails closed when DNS resolution errors (mocked lookupFn rejects)", async () => {
    const lookup: LookupFn = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(assertPublicHttpUrl("http://does-not-resolve.example", lookup)).rejects.toThrow();
  });

  // Regression coverage for a verified SSRF bypass: WHATWG's URL serializer
  // canonicalizes IPv4-mapped IPv6 literals to the HEX-hextet form
  // (`::ffff:169.254.169.254` -> `::ffff:a9fe:a9fe`), never the dotted-decimal
  // tail. A dotted-decimal-only regex for the "::ffff:a.b.c.d" shape silently
  // never matches real browser/fetch-canonicalized input, so the embedded
  // IPv4 must be recovered structurally from the expanded hextets, not by
  // string-matching the textual form.
  describe("IPv4-mapped / NAT64 IPv6 literal bypass regression", () => {
    it("throws for the hex-canonicalized IPv4-mapped loopback ([::ffff:127.0.0.1] -> [::ffff:7f00:1])", async () => {
      await expect(assertPublicHttpUrl("http://[::ffff:127.0.0.1]/")).rejects.toThrow();
    });

    it("throws for the hex-canonicalized IPv4-mapped cloud metadata address", async () => {
      await expect(assertPublicHttpUrl("http://[::ffff:169.254.169.254]/")).rejects.toThrow();
    });

    it("throws for the hex-canonicalized IPv4-mapped RFC1918 address", async () => {
      await expect(assertPublicHttpUrl("http://[::ffff:10.0.0.1]/")).rejects.toThrow();
    });

    it("resolves for an IPv4-mapped literal whose embedded address is genuinely public", async () => {
      await expect(assertPublicHttpUrl("http://[::ffff:93.184.216.34]/")).resolves.toBeUndefined();
    });

    it("throws for a NAT64-embedded loopback address (64:ff9b::7f00:1 -> 127.0.0.1)", async () => {
      await expect(assertPublicHttpUrl("http://[64:ff9b::7f00:1]/")).rejects.toThrow();
    });
  });
});
