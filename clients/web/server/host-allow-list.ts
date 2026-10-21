/**
 * The `Host`-header allow-list the production web server applies to every
 * request it answers.
 *
 * Why it exists: the origin allow-list on `/api/*` only sees requests that
 * carry an `Origin` header, and a browser sends none on a same-origin `GET`.
 * So a page on an attacker-controlled DNS name that is later re-pointed at
 * this machine's address (DNS rebinding) is *same-origin* with the Inspector
 * from the browser's point of view: it could `GET /`, read the API token
 * `index.html` carries, and replay it against `/api/*`. What such a page
 * cannot change is the `Host` header — the browser always sends the name the
 * page was loaded from — so rejecting a `Host` that is not one of ours closes
 * the whole chain before any HTML (and therefore any token) is served. This is
 * the same defence Vite applies in `--dev` (`server.allowedHosts`), whose
 * semantics this module follows.
 *
 * Allowed, compared case-insensitively and ignoring a single trailing dot:
 *
 * - `localhost` and any `*.localhost` name (RFC 6761: they always resolve to
 *   loopback, so no attacker can own one);
 * - any IPv4 literal and any bracketed IPv6 literal — a rebinding attack needs
 *   a DNS name, so an address in `Host` cannot be one;
 * - the bind host (`HOST`), when it is a specific name rather than a wildcard;
 * - the host of every `allowedOrigins` entry, since an origin the API accepts
 *   is by definition a name the browser is meant to reach us at;
 * - every entry of {@link ALLOWED_HOSTS_ENV}, for a reverse proxy that
 *   rewrites `Host` to a name none of the above covers. An entry starting with
 *   `.` (`.example.com`) also admits that domain and all of its subdomains,
 *   matching Vite's convention.
 *
 * **The port is not compared.** A rebinding page is rejected on its name
 * alone, and the port the browser sends is legitimately different from the one
 * bound whenever a port is remapped (`docker run -p 127.0.0.1:8080:6274`) or a
 * proxy terminates on `:443`. It is still parsed, so a malformed `Host` is
 * refused rather than guessed at.
 *
 * A request with **no** `Host` is refused: HTTP/1.1 requires it, and a client
 * that omits it is not a browser this check needs to accommodate.
 */

import { isIPv4, isIPv6 } from "node:net";
import { domainToASCII } from "node:url";
import type { Context, MiddlewareHandler, Next } from "hono";
import {
  canonicalUrlHost,
  isAllInterfacesHost,
} from "../../../core/node/hostUrl.ts";

/** Comma-separated extra hostnames the web server accepts in `Host`. */
export const ALLOWED_HOSTS_ENV = "MCP_INSPECTOR_ALLOWED_HOSTS";

/**
 * The characters a hostname a browser sends can contain: it punycodes an IDN
 * and refuses the rest, so anything else is not a browser's `Host` (a comma
 * in particular is what two `Host` headers joined together look like).
 */
const HOSTNAME_RE = /^[a-z0-9._-]+$/;

/**
 * Normalize a hostname for comparison: trim, lowercase, and drop one trailing
 * root dot (`localhost.` and `example.com.` name the same host as without it).
 */
function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Extract the hostname from a `Host` header value (`name`, `name:port`,
 * `[v6]`, `[v6]:port`), lowercased with any trailing dot removed. A bracketed
 * IPv6 literal keeps its brackets. Returns `null` for a value that is not a
 * well-formed host — an unterminated bracket, a bracketed non-IPv6 value, a
 * non-numeric or out-of-range port, or an empty name.
 */
export function parseHostHeader(value: string): string | null {
  const raw = value.trim().toLowerCase();
  let hostname: string;
  let port: string | undefined;
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end < 0) return null;
    hostname = raw.slice(0, end + 1);
    if (!isIPv6(hostname.slice(1, -1))) return null;
    const rest = raw.slice(end + 1);
    if (rest !== "") {
      if (!rest.startsWith(":")) return null;
      port = rest.slice(1);
    }
  } else {
    const colon = raw.indexOf(":");
    hostname = colon < 0 ? raw : raw.slice(0, colon);
    port = colon < 0 ? undefined : raw.slice(colon + 1);
  }
  if (port !== undefined) {
    if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) return null;
  }
  if (hostname.startsWith("[")) return hostname;
  const name = normalizeHostname(hostname);
  return HOSTNAME_RE.test(name) ? name : null;
}

/**
 * Parse {@link ALLOWED_HOSTS_ENV}: comma-separated hostnames, each optionally
 * prefixed with `.` to admit a whole domain. Entries are lowercased and lose a
 * trailing dot; an internationalized name is converted to punycode. An entry
 * that is not a bare hostname — it carries a scheme, a
 * port, a path, a wildcard or whitespace — is warned about and dropped, since
 * it could never equal the hostname parsed out of a `Host` header and keeping
 * it would leave the user believing a proxy name was admitted when it is not.
 */
export function parseAllowedHostsEnv(value: string | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    // An IDN entry is converted to the punycode form a browser sends, so
    // `bücher.example` matches rather than silently never matching.
    const domain = trimmed.startsWith(".") ? "." : "";
    const ascii = /[\s/:*@]/.test(trimmed)
      ? ""
      : domainToASCII(normalizeHostname(trimmed.slice(domain.length)));
    if (!HOSTNAME_RE.test(ascii)) {
      console.warn(
        `Ignoring invalid ${ALLOWED_HOSTS_ENV} entry: ${trimmed} (list bare hostnames, e.g. inspector.example.com or .example.com)`,
      );
      continue;
    }
    out.push(domain + ascii);
  }
  return out;
}

export interface HostAllowListOptions {
  /** The host the server binds (`HOST`). A wildcard adds nothing. */
  bindHost: string;
  /** The API origin allow-list; each entry's hostname is admitted. */
  allowedOrigins: readonly string[];
  /** Extra hostnames, typically from {@link ALLOWED_HOSTS_ENV}. */
  extraHosts?: readonly string[];
}

/**
 * The configured (non-implicit) hostnames a server accepts in `Host`, beyond
 * the always-allowed loopback names and IP literals. Exported for tests and
 * for anyone who needs to explain a rejection.
 */
export function configuredAllowedHosts(
  options: HostAllowListOptions,
): string[] {
  const hosts = new Set<string>();
  if (!isAllInterfacesHost(options.bindHost)) {
    hosts.add(normalizeHostname(canonicalUrlHost(options.bindHost)));
  }
  for (const origin of options.allowedOrigins) {
    try {
      const { hostname } = new URL(origin);
      if (hostname !== "") hosts.add(normalizeHostname(hostname));
    } catch {
      // The list is canonicalized before it gets here; an entry that still
      // will not parse contributes no host rather than failing the server.
    }
  }
  for (const extra of options.extraHosts ?? []) {
    hosts.add(normalizeHostname(extra));
  }
  return [...hosts];
}

/**
 * Build the predicate that decides whether a `Host` header value is one this
 * server answers. See the module comment for the rules.
 */
export function createHostAllowList(
  options: HostAllowListOptions,
): (hostHeader: string | undefined) => boolean {
  const configured = configuredAllowedHosts(options);
  return (hostHeader) => {
    if (hostHeader === undefined) return false;
    const hostname = parseHostHeader(hostHeader);
    if (hostname === null) return false;
    if (hostname.startsWith("[")) return true; // parse validated it as IPv6
    if (isIPv4(hostname)) return true;
    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
      return true;
    }
    for (const allowed of configured) {
      if (allowed === hostname) return true;
      if (
        allowed.startsWith(".") &&
        (allowed.slice(1) === hostname || hostname.endsWith(allowed))
      ) {
        return true;
      }
    }
    return false;
  };
}

/**
 * Hono middleware rejecting any request whose `Host` the allow-list refuses,
 * with a plain-text 403 that names the host and the variable that admits it.
 * Registered ahead of every route that serves HTML or the API.
 */
export function hostAllowListMiddleware(
  options: HostAllowListOptions,
): MiddlewareHandler {
  const isAllowed = createHostAllowList(options);
  return async (c: Context, next: Next) => {
    const host = c.req.header("host");
    if (!isAllowed(host)) {
      return c.text(
        `Forbidden: Host "${host ?? ""}" is not allowed. To serve the Inspector under this name, add it to ${ALLOWED_HOSTS_ENV} (or to ALLOWED_ORIGINS).`,
        403,
      );
    }
    await next();
  };
}
