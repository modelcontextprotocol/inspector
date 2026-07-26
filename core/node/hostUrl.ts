import { isIPv6 } from "node:net";

/** Strip a single surrounding `[...]` pair from a bracketed IPv6 literal; other hosts pass through. */
export function stripBrackets(host: string): string {
  return host.replace(/^\[(.*)\]$/, "$1");
}

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
  // Strip surrounding brackets and any zone id before the IPv6 check, so a
  // bracketed-with-zone input (`[fe80::1%eth0]`) still yields a valid URL host.
  // (A non-IPv6 value is returned as-given — this normalizes IPv6 literals, it
  // doesn't validate arbitrary hosts.)
  const bare = stripBrackets(h).split("%")[0];
  return isIPv6(bare) ? `[${bare}]` : h;
}

/**
 * Unmap an IPv4-mapped IPv6 host (`[::ffff:7f00:1]`) to its dotted IPv4 form
 * (`127.0.0.1`) — the address the socket actually answers on (a
 * `::ffff:127.0.0.1` bind is reachable at `127.0.0.1`, not `::1`). Other hosts
 * pass through. Mirrors the bind guard, which folds the mapped *wildcard*
 * (`::ffff:0:0`) into its all-interfaces set.
 */
function unmapIpv4MappedHost(host: string): string {
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(
    stripBrackets(host),
  );
  if (!m) return host;
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * Canonicalize a bind host the way a browser does before building `Origin`, so
 * that the origin allow-list, the startup banner, and the sandbox URL all use
 * the *same* form and can't disagree. Non-canonical spellings of the same
 * address — `127.1` / `0x7f.0.0.1` / `2130706433` all mean `127.0.0.1`,
 * `0:0:0:0:0:0:0:1` / `::0001` mean `::1` — otherwise produce hosts that miss
 * the loopback lookup or don't match the header the browser sends.
 *
 * One step **intentionally diverges** from browser canonicalization: an
 * IPv4-mapped IPv6 host is unmapped to its dotted IPv4 form (the address the
 * socket answers on), where a browser would keep the mapped literal. Because the
 * banner/sandbox URL are canonicalized through here too, `banner ⊆ allowedOrigins`
 * holds by construction — the advertised URL is always an allow-listed origin.
 *
 * `new URL().hostname` returns the URL-ready form (bracketed for IPv6); falls
 * back to the formatted input if it isn't a parseable URL host.
 */
export function canonicalUrlHost(host: string): string {
  const formatted = formatHostForUrl(host.trim().toLowerCase());
  try {
    return unmapIpv4MappedHost(new URL(`http://${formatted}`).hostname);
  } catch {
    return formatted;
  }
}
