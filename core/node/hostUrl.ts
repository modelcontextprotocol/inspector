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

/**
 * Canonical spellings of the all-interfaces (unspecified) address. Every IPv6
 * wildcard spelling (`::`, `::0`, `0:0:…:0`, `::0.0.0.0`, …) canonicalizes to
 * `::` and the IPv4-mapped wildcard to `::ffff:0:0` (see {@link canonicalizeIpv6}),
 * so those two entries cover the whole IPv6 family; `0.0.0.0` is the IPv4
 * wildcard and `""` is Node's `listen()` unspecified address. All bind *every*
 * interface. {@link isAllInterfacesHost} additionally folds the legacy IPv4
 * spellings the OS resolver still binds as `0.0.0.0`.
 */
const ALL_INTERFACES_LITERALS = new Set(["", "0.0.0.0", "::", "::ffff:0:0"]);

/**
 * Canonicalize an IPv6 literal via the WHATWG URL serializer, which compresses
 * zero-runs — so `::0`, `0::0`, `::0.0.0.0`, and the fully-expanded
 * `0000:…:0000` all collapse to `::`, and `::ffff:0.0.0.0` → `::ffff:0:0`. This
 * is what lets a small literal set catch every all-zero IPv6 spelling rather
 * than only the handful written out. Non-IPv6 input passes through unchanged.
 *
 * The zone index (`%eth0`) is stripped first: `net.isIPv6` accepts it but
 * `new URL()` rejects a zone id outright (even `%25`-encoded), so passing it
 * through would throw. The zone is irrelevant to *which* address this is, so
 * dropping it is correct for detection — `::%eth0` still canonicalizes to `::`.
 */
function canonicalizeIpv6(value: string): string {
  if (!isIPv6(value)) return value;
  const [address] = value.split("%");
  return new URL(`http://[${address}]`).hostname.slice(1, -1);
}

/**
 * Parse one dotted-address part (or a bare address) the way the C `inet_aton`
 * resolver does — decimal, `0`-prefixed octal, and `0x`-prefixed hex are all
 * accepted. Returns `NaN` for anything non-numeric (e.g. a hostname label).
 */
function parseAddressPart(part: string): number {
  if (/^0x[0-9a-f]+$/.test(part)) return parseInt(part, 16);
  if (/^[0-9]+$/.test(part)) return parseInt(part, 10);
  return NaN;
}

/**
 * True when `value` is an all-zero IPv4 address in any legacy spelling the OS
 * still binds as the `0.0.0.0` wildcard: the bare integer `0`, `0x0`, dotted
 * `0.0.0.0`, `000.000.000.000`, `0x0.0.0.0`, and the short forms `0.0` / `0.0.0`
 * (Node/`inet_aton` accept 1–4 parts; `parseAddressPart`'s `[0-9]+` branch does
 * double duty for decimal and `0`-prefixed octal). Guards the near-miss
 * bypasses of the literal set above. The `> 4` reject is intentional — 1–3
 * parts are valid `inet_aton` spellings, so this is deliberately NOT
 * `parts.length === 4`. Called from {@link isAllInterfacesHost} with any
 * normalized host, so it may receive an IPv6 literal (`::1`) — the dot-split
 * yields a single non-numeric part → `NaN` → `false`, which is correct.
 */
function isAllZeroIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length > 4) return false;
  return parts.every((part) => parseAddressPart(part) === 0);
}

/**
 * True when `host` binds all interfaces (`0.0.0.0` / `::` / empty / their legacy
 * spellings) rather than loopback only. Shared by the web bind guard, the
 * banner/sandbox wildcard→`localhost` substitution, and the CLI deep-link.
 *
 * The value is run through {@link canonicalUrlHost} first — Node's resolver
 * applies the IDNA Unicode→ASCII mapping before parsing the literal, so a
 * fullwidth `HOST="０"` (U+FF10) binds `0.0.0.0`; canonicalizing (via `new URL`,
 * which applies the same mapping) before the address check catches those
 * spellings and keeps this predicate reasoning about the *address* the socket
 * binds, not the raw string. Idempotent for ASCII hosts.
 */
export function isAllInterfacesHost(host: string): boolean {
  const normalized = canonicalizeIpv6(stripBrackets(canonicalUrlHost(host)));
  return ALL_INTERFACES_LITERALS.has(normalized) || isAllZeroIpv4(normalized);
}

/**
 * True when `host` is a loopback address — `localhost`, anything in `127.0.0.0/8`
 * (incl. IPv4-mapped `::ffff:127.x`, which {@link canonicalUrlHost} unmaps), or
 * `::1`. Canonicalized first, so non-canonical spellings (`127.1`, `0x7f.1`,
 * `2130706433`, `0:0:…:1`) resolve correctly. Used to constrain the OAuth
 * callback listener, which must be loopback (it receives the authorization code
 * over plaintext `http`; RFC 8252 §7.3 only sanctions that for loopback).
 */
export function isLoopbackHost(host: string): boolean {
  // Drop a root FQDN dot (`localhost.` binds loopback but WHATWG keeps the dot);
  // IP literals never carry one (WHATWG strips it for those).
  const h = canonicalUrlHost(host).replace(/\.$/, "");
  // Octets are range-bounded (`canonicalUrlHost` returns the raw input when
  // `new URL` throws, so `\d{1,3}` alone would pass `127.999.0.1`).
  return (
    h === "localhost" ||
    h === "[::1]" ||
    /^127(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(h)
  );
}
