import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

// Injectable resolver shape, matching the subset of node:dns/promises#lookup
// we need. Defaults to the real resolver; tests inject a stub so DNS is never
// actually touched (hermetic).
export type LookupFn = (
  hostname: string,
  opts: { all: true },
) => Promise<{ address: string; family: number }[]>;

const defaultLookup: LookupFn = dnsLookup as unknown as LookupFn;

// Thrown for any blocked target — bad scheme, unparseable URL, private/
// loopback/link-local/CGNAT/metadata address (literal or DNS-resolved), or a
// failed DNS lookup (fail closed).
export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

// Guards outbound webhook fetches against SSRF: only plain http(s) URLs whose
// resolved IP address(es) are all public are allowed. Hostnames are resolved
// via DNS (not just checked as literals) so a hostname that round-trips to a
// private/internal address is blocked too (DNS-rebinding defense) — checking
// only the literal string in the URL would miss `http://attacker-controlled
// -dns-name/` that resolves to 127.0.0.1 or an internal IP.
export async function assertPublicHttpUrl(
  raw: string,
  lookupFn: LookupFn = defaultLookup,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlockedError(`blocked host: invalid URL "${raw}"`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError(`blocked host: unsupported scheme "${url.protocol}"`);
  }

  // URL.hostname wraps IPv6 literals in brackets ("[::1]") — strip them so
  // node:net#isIP and the range checks below see the bare address.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  const literalVersion = isIP(hostname);
  let addresses: string[];
  if (literalVersion !== 0) {
    addresses = [hostname];
  } else {
    let results: { address: string; family: number }[];
    try {
      results = await lookupFn(hostname, { all: true });
    } catch {
      // Fail closed: an unresolvable host is not provably public.
      throw new SsrfBlockedError(`blocked host: DNS resolution failed for "${hostname}"`);
    }
    if (!results || results.length === 0) {
      throw new SsrfBlockedError(`blocked host: DNS resolution returned no addresses for "${hostname}"`);
    }
    addresses = results.map((r) => r.address);
  }

  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new SsrfBlockedError(`blocked host: "${addr}" is not a public address`);
    }
  }
}

function isBlockedIp(addr: string): boolean {
  const version = isIP(addr);
  if (version === 4) return isPrivateV4(addr);
  if (version === 6) return isPrivateV6(addr);
  // Not a recognizable IP literal at all — fail closed.
  return true;
}

// IPv4 private/reserved ranges relevant to SSRF: unspecified, RFC1918
// privates, CGNAT, loopback, link-local (incl. cloud metadata 169.254.169.254),
// the IETF protocol-assignments block, and the benchmarking range.
export function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed — fail closed
  }
  const [a, b, c] = parts;

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true; // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local + cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 (IETF protocol assignments)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmarking)
  if (a === 255 && b === 255 && c === 255 && parts[3] === 255) return true; // 255.255.255.255 broadcast

  return false;
}

// IPv6 private/reserved ranges: unspecified (::), loopback (::1), unique
// local addresses (fc00::/7), link-local (fe80::/10), and IPv4-mapped
// addresses (::ffff:a.b.c.d) which are unwrapped and re-checked as v4.
export function isPrivateV6(ip: string): boolean {
  const norm = ip.toLowerCase();

  if (norm === "::" || norm === "::1") return true;

  const mapped = norm.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);

  const firstHextet = expandV6(norm)[0];
  if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true; // fc00::/7 (ULA)
  if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true; // fe80::/10 (link-local)

  return false;
}

// Minimal IPv6 expansion to 8 x 16-bit groups, just enough to inspect the
// leading hextet for the range checks above (does not need to handle every
// textual form RFC 4291 allows — only what node:dns/promises + literal URLs
// realistically produce).
function expandV6(ip: string): number[] {
  const [headPart, tailPart] = ip.split("::");
  const head = headPart ? headPart.split(":").filter(Boolean) : [];
  const tail = tailPart !== undefined ? tailPart.split(":").filter(Boolean) : [];

  let groups: string[];
  if (tailPart !== undefined) {
    const missing = Math.max(8 - head.length - tail.length, 0);
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  } else {
    groups = ip.split(":");
  }

  return Array.from({ length: 8 }, (_, i) => parseInt(groups[i] ?? "0", 16) || 0);
}
