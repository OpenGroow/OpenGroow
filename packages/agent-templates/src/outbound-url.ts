/**
 * Outbound URL policy of the hosted deployment (#670). A package declares MCP
 * server URLs the shared backend (Convex) calls; on the hosted deployment a
 * URL that targets a private, loopback, link-local, metadata or otherwise
 * reserved address is refused at install time, so a package cannot turn the
 * backend into a proxy to internal services. Self-hosted deployments do not
 * apply this policy (their operator legitimately points at local services).
 *
 * The check is syntactic, done on the WHATWG-parsed URL: the parser already
 * normalizes the encoded-IP tricks (`2130706433`, `0x7f.1`, `017700000001`)
 * to a dotted IPv4, and IPv6 literals to their canonical hex form. A public
 * DNS name that *resolves* to a private address cannot be seen at install
 * time; that needs a resolution-time guard at call time.
 */

const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp"];

type Cidr4 = readonly [base: string, bits: number];

const RESERVED_IPV4: readonly Cidr4[] = [
  ["0.0.0.0", 8], // "this network", unspecified
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
];

function ipv4ToInt(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value;
}

function isReservedIpv4(value: number): boolean {
  return RESERVED_IPV4.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    const start = ipv4ToInt(base)!;
    return value >= start && value < start + size;
  });
}

/** The eight 16-bit groups of a canonical IPv6 literal (without brackets), or undefined. */
function ipv6Groups(address: string): number[] | undefined {
  let text = address.toLowerCase();
  // A trailing dotted quad (not produced by the URL parser, handled defensively).
  const quad = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (quad) {
    const v4 = ipv4ToInt(quad[2]);
    if (v4 === undefined) return undefined;
    text = `${quad[1]}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const parse = (s: string) => (s === "" ? [] : s.split(":"));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const numbers = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return numbers.some(Number.isNaN) ? undefined : numbers;
}

function isReservedIpv6(address: string): boolean {
  const g = ipv6Groups(address);
  if (!g) return true; // cannot be understood: refuse
  const embedded = (hi: number, lo: number) => isReservedIpv4(hi * 65536 + lo);
  const firstSixZero = g.slice(0, 6).every((x) => x === 0);
  if (g.slice(0, 7).every((x) => x === 0)) return true; // :: and ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return embedded(g[6], g[7]); // IPv4-mapped
  if (firstSixZero) return true; // IPv4-compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local (fc00::/7), incl. fd00:ec2::254
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard-only
  return false;
}

/**
 * Why `raw` may not be called by the hosted backend, or undefined when it is an
 * ordinary public http(s) URL.
 */
export function outboundUrlProblem(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `${JSON.stringify(raw)} is not an absolute URL`;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return `${JSON.stringify(raw)} must be an http(s) URL`;
  if (url.username !== "" || url.password !== "") return `${JSON.stringify(raw)} must not embed credentials (not allowed on the hosted deployment)`;

  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  const refuse = (why: string) => `${JSON.stringify(raw)} targets ${why}, which is not allowed on the hosted deployment`;
  if (host === "") return refuse("no host");

  if (host.startsWith("[") && host.endsWith("]")) {
    return isReservedIpv6(host.slice(1, -1)) ? refuse("a private or reserved IPv6 address") : undefined;
  }
  const v4 = ipv4ToInt(host);
  if (v4 !== undefined) return isReservedIpv4(v4) ? refuse("a private or reserved IPv4 address") : undefined;

  if (host === "localhost" || host === "metadata" || INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) {
    return refuse("an internal host name");
  }
  // A single-label name only resolves inside a private network (compose services, search domains).
  if (!host.includes(".")) return refuse("an internal host name");
  // A trailing numeric label that did not parse as IPv4 would be an (ignored) IP form.
  if (/^[0-9x.]+$/i.test(host)) return refuse("a malformed IP address");
  return undefined;
}
