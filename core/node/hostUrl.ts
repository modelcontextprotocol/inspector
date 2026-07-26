import { isIPv6 } from "node:net";

/**
 * Format a bind host for use inside a URL authority. An IPv6 literal must be
 * bracketed (`http://[::1]:6274`); every other host — loopback names, IPv4,
 * hostnames, already-bracketed IPv6 — passes through unchanged. Shared by the
 * web origin allow-list, the startup banner, the sandbox URL, and the CLI
 * deep-link so a bound IPv6 host is formatted the same way everywhere.
 *
 * Bracketing keys off `net.isIPv6`, not the presence of a `:`, so a mistyped
 * `host:port` isn't wrapped as `[host:port]`. A zone index (`%eth0`) is dropped:
 * a URL authority cannot carry one (`new URL()` rejects it even `%25`-encoded),
 * and the zone is host-local and meaningless to a remote client anyway.
 */
export function formatHostForUrl(host: string): string {
  const h = host.trim();
  if (h.startsWith("[")) return h; // already a bracketed IPv6 literal
  const [address] = h.split("%"); // strip any IPv6 zone id
  return isIPv6(address) ? `[${address}]` : h;
}
