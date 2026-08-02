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
// the IETF protocol-assignments block, the benchmarking range, and
// multicast/reserved (224.0.0.0/4, 240.0.0.0/4 — defense in depth; these
// aren't classic SSRF targets but have no business being a webhook
// destination either).
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
  if (a >= 224 && a <= 239) return true; // 224.0.0.0/4 (multicast)
  if (a >= 240) return true; // 240.0.0.0/4 (reserved, incl. 255.255.255.255 broadcast)

  return false;
}

// IPv6 private/reserved ranges: unspecified (::), loopback (::1), unique
// local addresses (fc00::/7), link-local (fe80::/10), the NAT64 well-known
// prefix (64:ff9b::/96), and IPv4-mapped/-compatible addresses, which embed
// an IPv4 address that is unwrapped and re-checked with isPrivateV4.
//
// IMPORTANT: the IPv4-mapped/NAT64/compatible checks below are STRUCTURAL —
// they inspect the fully-expanded 8-hextet numeric form, not the textual
// address string. A prior version matched only the dotted-decimal textual
// shape "::ffff:a.b.c.d" via regex, which never fires against real input:
// WHATWG's URL serializer (what `new URL(...)` and therefore every http
// client produces) always canonicalizes IPv4-mapped literals to the HEX
// hextet form (`::ffff:169.254.169.254` -> `::ffff:a9fe:a9fe`), so the regex
// silently never matched and the address fell through to the "public"
// default. Expanding to hextets first and reconstructing the embedded IPv4
// from the numeric groups closes that bypass regardless of how the address
// was spelled.
export function isPrivateV6(ip: string): boolean {
  const hextets = expandV6(ip.toLowerCase());

  if (hextets.every((h) => h === 0)) return true; // :: (unspecified)
  if (hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1) return true; // ::1 (loopback)

  // IPv4-mapped (::ffff:0:0/96): hextets 0-4 are zero, hextet 5 is 0xffff,
  // and the embedded IPv4 address is packed into hextets 6-7.
  if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff) {
    return isPrivateV4(embeddedV4(hextets[6]!, hextets[7]!));
  }

  // IPv4-compatible (legacy, RFC 4291-deprecated "::a.b.c.d" form): hextets
  // 0-5 are all zero and the embedded IPv4 is packed into hextets 6-7. Any
  // remaining all-zero-prefix case (e.g. "::5") also falls in here and
  // reconstructs to a 0.0.0.0/8 address, which isPrivateV4 already blocks —
  // consistent fail-closed behavior for an ambiguous/unusual literal.
  if (hextets.slice(0, 6).every((h) => h === 0)) {
    return isPrivateV4(embeddedV4(hextets[6]!, hextets[7]!));
  }

  // NAT64 well-known prefix (64:ff9b::/96): the trailing 32 bits are an
  // embedded IPv4 address reachable via the NAT64 gateway.
  if (
    hextets[0] === 0x0064 &&
    hextets[1] === 0xff9b &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0
  ) {
    return isPrivateV4(embeddedV4(hextets[6]!, hextets[7]!));
  }

  const firstHextet = hextets[0]!;
  if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true; // fc00::/7 (ULA)
  if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true; // fe80::/10 (link-local)

  return false;
}

// Reconstructs the dotted-decimal IPv4 address embedded in a pair of 16-bit
// hextets (used for IPv4-mapped, IPv4-compatible, and NAT64 addresses).
function embeddedV4(hi: number, lo: number): string {
  return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join(".");
}

// IPv6 expansion to 8 x 16-bit groups. Handles both "::"-compressed and
// fully-written forms — enough to inspect any hextet for the range checks
// above (does not need to handle every textual form RFC 4291 allows — only
// what node:dns/promises + literal URLs realistically produce).
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
