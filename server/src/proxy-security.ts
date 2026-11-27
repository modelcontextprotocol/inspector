/**
 * SSRF-prevention helpers for the /fetch reverse proxy.
 *
 * Extracted from index.ts so they can be unit-tested independently.
 *
 * ## DNS-rebinding / TOCTOU threat model
 *
 * `assertSafeProxyTarget` resolves the target hostname and validates every
 * returned IP against the block-list.  The resolved IPs are returned to the
 * caller so they can be passed to `createPinnedAgent`, which builds an
 * http/https.Agent whose `lookup` callback unconditionally returns the
 * pre-validated IP.  The agent is then passed to `node-fetch`, which calls the
 * lookup hook instead of doing its own DNS query.
 *
 * Without this pinning there is a TOCTOU race: an attacker who controls the
 * target domain can flip its DNS record to 169.254.169.254 (AWS/GCP/Azure
 * instance-metadata) in the window between `assertSafeProxyTarget` returning
 * and `fetch` performing its own resolution.  Pinning eliminates that window.
 */

import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type dns from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";

// ---------------------------------------------------------------------------
// Block-list
// ---------------------------------------------------------------------------

/**
 * Cloud instance-metadata services reachable at a fixed IPv4 address outside
 * 169.254.0.0/16. Matched exactly, against the dotted-quad form `isIP`
 * accepts (which has no leading zeros, so each address has one spelling).
 *
 *  - 100.100.100.200  (Alibaba Cloud ECS metadata service)
 *  - 192.0.0.192  (Oracle Cloud Infrastructure Classic metadata service)
 */
const METADATA_IPV4_ADDRESSES: ReadonlySet<string> = new Set([
  "100.100.100.200",
  "192.0.0.192",
]);

/**
 * Returns true if `ip` is a link-local or cloud-metadata address that must
 * never be reachable through the proxy.
 *
 * Blocked:
 *  - 169.254.0.0/16  (IPv4 link-local; includes the 169.254.169.254 metadata
 *    service of AWS, GCP, Azure, Oracle Cloud and most others)
 *  - METADATA_IPV4_ADDRESSES  (metadata services at a fixed address outside
 *    link-local, which the range above misses)
 *  - ::ffff: IPv4-mapped IPv6 variants of every IPv4 address above, in both
 *    the dotted and the hex serialization
 *  - NAT64 variants of the same addresses, under the RFC 6052 well-known
 *    prefix 64:ff9b::/96 and the RFC 8215 local-use prefix 64:ff9b:1::/48
 *    (see `isNat64Embedded`): on a host with NAT64 egress,
 *    64:ff9b::a9fe:a9fe *is* 169.254.169.254
 *  - fe80::/10  (IPv6 link-local)
 *  - fd00:ec2::254  (AWS IPv6 instance-metadata)
 *
 * Every IPv6 form is matched on its parsed value (`ipv6Groups`), not its
 * spelling, so the non-canonical spellings `isIP` accepts (leading zeros, an
 * uncompressed run of zero groups, uppercase, a dotted tail) are caught as
 * well as the canonical one.
 *
 * The out-of-range metadata addresses are blocked exactly, never by their
 * enclosing range: 100.100.100.200 sits in 100.64.0.0/10, the CGNAT block
 * Tailscale also uses (its MagicDNS resolver is 100.100.100.100), and a
 * tailnet MCP server is as legitimate a target as a LAN one.
 */
export function isBlockedProxyAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const parts = ip.split(".").map(Number);
    return (
      (parts[0] === 169 && parts[1] === 254) || METADATA_IPV4_ADDRESSES.has(ip)
    );
  }
  if (kind === 6) {
    const groups = ipv6Groups(ip);
    const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;

    // IPv4-mapped (::ffff:0:0/96) and NAT64 addresses both carry an IPv4
    // address in the low 32 bits; the verdict is that address's.
    const highZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
    if ((highZero && g5 === 0xffff) || isNat64Embedded(groups)) {
      return isBlockedProxyAddress(
        `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`,
      );
    }

    if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10
    // fd00:ec2::254 (AWS IPv6 IMDS)
    return (
      g0 === 0xfd00 &&
      g1 === 0xec2 &&
      g2 === 0 &&
      g3 === 0 &&
      g4 === 0 &&
      g5 === 0 &&
      g6 === 0 &&
      g7 === 0x254
    );
  }
  return false;
}

/**
 * Whether an IPv6 address (as `ipv6Groups`) is a NAT64 address whose IPv4
 * destination is its low 32 bits.
 *
 *  - 64:ff9b::/96, the RFC 6052 well-known prefix, is a /96 by definition, so
 *    the IPv4 address is always the low 32 bits.
 *  - 64:ff9b:1::/48, the RFC 8215 local-use prefix, is included because it
 *    exists for exactly this translation and has no other use: an address in
 *    it is never a legitimate destination of its own. An operator carves a
 *    NAT64 prefix out of it, and the /96 that RFC 6052 recommends puts the
 *    IPv4 address in the low 32 bits as above. A shorter carve-out (/48,
 *    /56 or /64) is not decoded, because which layout an address uses is
 *    not recoverable from the address itself. Those layouts put the IPv4
 *    address elsewhere (split around the reserved `u` octet for /48 and /56,
 *    wholly after it for /64) and zero the suffix, so their low 32 bits read
 *    as `d.0.0.0` or `0.0.0.0` and are not blocked.
 */
function isNat64Embedded(groups: readonly number[]): boolean {
  const [g0, g1, g2, g3, g4, g5] = groups;
  if (g0 !== 0x64 || g1 !== 0xff9b) return false;
  return g2 === 1 || (g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0);
}

/**
 * The eight 16-bit groups of an address `isIP` has already accepted as IPv6,
 * whatever its spelling: a zone index is dropped, a dotted IPv4 tail becomes
 * the last two groups, and a `::` expands to the zero groups it stands for.
 */
function ipv6Groups(ip: string): number[] {
  let addr = ip.replace(/%.*$/, "");
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    const [a, b, c, d] = tail.split(".").map(Number);
    const high = ((a << 8) | b).toString(16);
    const low = ((c << 8) | d).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const toGroups = (part: string): number[] =>
    part === "" ? [] : part.split(":").map((g) => parseInt(g, 16));
  const halves = addr.split("::");
  if (halves.length === 1) return toGroups(addr);
  const head = toGroups(halves[0]);
  const rest = toGroups(halves[1]);
  const zeros = new Array<number>(8 - head.length - rest.length).fill(0);
  return [...head, ...zeros, ...rest];
}

// ---------------------------------------------------------------------------
// DNS validation
// ---------------------------------------------------------------------------

/** Raised when the /fetch proxy is asked to reach a disallowed target. */
export class ProxyTargetError extends Error {}

/**
 * Resolves `parsedUrl`'s hostname and asserts that every returned IP is
 * outside the block-list.
 *
 * Returns the list of validated IP strings so the caller can pin one of them
 * into an HTTP agent (see `createPinnedAgent`), eliminating the TOCTOU window
 * between this check and the actual `fetch()` call.
 *
 * @throws {ProxyTargetError} if the host cannot be resolved or any resolved
 *   address falls inside the block-list.
 */
export async function assertSafeProxyTarget(parsedUrl: URL): Promise<string[]> {
  const host = parsedUrl.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dnsLookup(host, { all: true })).map((r) => r.address);
    } catch {
      throw new ProxyTargetError(`Could not resolve host: ${host}`);
    }
  }

  if (addresses.length === 0) {
    throw new ProxyTargetError(`Could not resolve host: ${host}`);
  }

  for (const address of addresses) {
    if (isBlockedProxyAddress(address)) {
      throw new ProxyTargetError(
        `Refusing to proxy request to blocked address (${address})`,
      );
    }
  }

  return addresses;
}

// ---------------------------------------------------------------------------
// IP-pinned agent factory
// ---------------------------------------------------------------------------

/**
 * Creates an `http.Agent` or `https.Agent` whose internal `lookup` hook always
 * returns `pinnedIps`, bypassing the OS resolver entirely.
 *
 * Pass this agent to `node-fetch` on every hop of `safeProxyFetch` so the TCP
 * connection always goes to an IP that was validated by `assertSafeProxyTarget`
 * — even if the domain's DNS record changes mid-flight.
 *
 * Every address `assertSafeProxyTarget` returned is handed to the hook, not
 * just the first, so Node keeps its normal address-family fallback: a
 * dual-stack host whose first address is unreachable (IPv6 on an IPv4-only
 * network, say) still connects via a later one. The set it may choose from is
 * exactly the prevalidated set, so the TOCTOU guarantee is unchanged.
 *
 * @param protocol - `"http:"` or `"https:"` (from `URL.protocol`)
 * @param pinnedIps - Validated IPv4/IPv6 address strings, in preference order
 */
export function createPinnedAgent(
  protocol: string,
  pinnedIps: string[],
): http.Agent | https.Agent {
  if (pinnedIps.length === 0) {
    throw new ProxyTargetError("No validated address to connect to");
  }

  const resolved: dns.LookupAddress[] = pinnedIps.map((address) => ({
    address,
    family: isIP(address) === 6 ? 6 : 4,
  }));

  // Node.js lookup signature: (hostname, options, callback).
  //
  // The callback shape depends on `options.all`. Node's `net.connect` runs with
  // `autoSelectFamily` enabled by default (Node >= 20), so it calls the hook
  // with `{ all: true }` and expects an ARRAY of `{ address, family }` — handing
  // it the scalar form there fails the connection with ERR_INVALID_IP_ADDRESS.
  // Both shapes are supported so the agent works on either call path.
  const lookup = (
    _hostname: string,
    opts: dns.LookupOptions | undefined,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | dns.LookupAddress[],
      family?: number,
    ) => void,
  ): void => {
    if (opts?.all) {
      callback(null, resolved);
      return;
    }
    callback(null, resolved[0].address, resolved[0].family);
  };

  if (protocol === "https:") {
    return new https.Agent({ lookup } as https.AgentOptions);
  }
  return new http.Agent({ lookup } as http.AgentOptions);
}
