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
});
