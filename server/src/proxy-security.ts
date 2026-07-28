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
import { lookup as dnsLookup } from "node:dns/promises";

// ---------------------------------------------------------------------------
// Block-list
// ---------------------------------------------------------------------------

/**
 * Returns true if `ip` is a link-local or cloud-metadata address that must
 * never be reachable through the proxy.
 *
 * Blocked ranges:
 *  - 169.254.0.0/16  (IPv4 link-local; includes 169.254.169.254 IMDS)
 *  - ::ffff:169.254.x.x  (IPv4-mapped IPv6 variants of the above)
 *  - fe80::/10  (IPv6 link-local)
 *  - fd00:ec2::254  (AWS IPv6 instance-metadata)
 */
export function isBlockedProxyAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const parts = ip.split(".").map(Number);
    return parts[0] === 169 && parts[1] === 254;
  }
  if (kind === 6) {
    const addr = ip.toLowerCase();

    // IPv4-mapped IPv6 — two serialization forms:
    //   dotted   ::ffff:169.254.169.254
    //   hex      ::ffff:a9fe:a9fe
    const mapped = addr.match(/^::ffff:(.+)$/);
    if (mapped) {
      const tail = mapped[1];
      if (isIP(tail) === 4) {
        return isBlockedProxyAddress(tail);
      }
      const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hex) {
        const high = parseInt(hex[1], 16);
        const low = parseInt(hex[2], 16);
        return isBlockedProxyAddress(
          `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
        );
      }
    }

    if (/^fe[89ab]/.test(addr)) return true; // fe80::/10
    return addr === "fd00:ec2::254"; // AWS IPv6 IMDS
  }
  return false;
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
export async function assertSafeProxyTarget(
  parsedUrl: URL,
): Promise<string[]> {
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
 * returns `pinnedIp`, bypassing the OS resolver entirely.
 *
 * Pass this agent to `node-fetch` on every hop of `safeProxyFetch` so the TCP
 * connection always goes to the IP that was validated by `assertSafeProxyTarget`
 * — even if the domain's DNS record changes mid-flight.
 *
 * @param protocol - `"http:"` or `"https:"` (from `URL.protocol`)
 * @param pinnedIp - A validated IPv4 or IPv6 address string
 */
export function createPinnedAgent(
  protocol: string,
  pinnedIp: string,
): http.Agent | https.Agent {
  const family = isIP(pinnedIp) === 6 ? 6 : 4;

  // Node.js lookup signature: (hostname, options, callback)
  const lookup = (
    _hostname: string,
    _opts: unknown,
    callback: (err: Error | null, address: string, family: number) => void,
  ): void => {
    callback(null, pinnedIp, family);
  };

  if (protocol === "https:") {
    return new https.Agent({ lookup } as https.AgentOptions);
  }
  return new http.Agent({ lookup } as http.AgentOptions);
}
