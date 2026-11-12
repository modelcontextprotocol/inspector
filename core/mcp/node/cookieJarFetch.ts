/**
 * A connection-scoped HTTP cookie jar for the remote MCP transports (#2936).
 *
 * The Node `fetch` neither stores `Set-Cookie` nor replays `Cookie`, so a
 * server deployed as several replicas behind a load balancer that routes by
 * **cookie affinity** is unreachable past `initialize`: the balancer hands out
 * its affinity cookie on the first response, every later request leaves
 * without it, and the requests that round-robin onto a replica not holding the
 * MCP session are answered `404 Session not found`.
 *
 * The jar is opt-in per server (`InspectorServerSettings.cookieJar`) and
 * deliberately small — enough for an affinity cookie, not a browser:
 *
 * - **Same origin only.** Cookies are stored from, and replayed onto, requests
 *   whose origin (scheme + host + port) is the MCP server's own. The SDK sends
 *   OAuth discovery and token requests through the same fetch, usually to
 *   another origin; those are neither read nor stamped. Because the origin
 *   includes the scheme, a cookie learned over `https` is only ever replayed
 *   over `https`.
 * - **Host-only, path-less.** `Domain` and `Path` are ignored: a cookie is
 *   replayed to the server's whole origin and never to another host. That is
 *   narrower than a browser for `Domain` and wider for `Path`, which is the
 *   right trade for one MCP endpoint.
 * - **Expiry.** `Max-Age` wins over `Expires` (RFC 6265 §5.3); a cookie whose
 *   expiry has passed — the way a server deletes one — is removed.
 * - **Bounded.** At most {@link MAX_COOKIES} entries, each `name=value` pair at
 *   most {@link MAX_COOKIE_BYTES} bytes; the oldest entry is evicted first.
 * - **Lifetime.** One jar per transport, held only in memory. Cookies never
 *   outlive the connection and are never written to disk, so a reconnect
 *   re-learns affinity from scratch and nothing leaks between servers.
 *
 * Cookies are credentials, so nothing here logs them. The Network log records
 * the `Cookie` / `Set-Cookie` headers this wrapper sends and reads, and
 * redacts both (`core/mcp/fetchTracking.ts`).
 */

/** Most cookies one connection's jar holds; the oldest is evicted past it. */
export const MAX_COOKIES = 50;
/** Largest `name=value` pair the jar accepts, in UTF-8 bytes. */
export const MAX_COOKIE_BYTES = 4096;

interface StoredCookie {
  value: string;
  /** Epoch ms after which the cookie is dropped; `undefined` = session. */
  expiresAt: number | undefined;
}

/**
 * The cookies one connection has learned from its server's origin. Shared by
 * every fetch the transport makes, so a cookie delivered on the legacy SSE
 * `GET` stream is replayed on its `POST`s and vice versa.
 */
export class ConnectionCookieJar {
  /** Insertion-ordered, so the first key is the oldest entry. */
  private readonly cookies = new Map<string, StoredCookie>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Number of live (unexpired) cookies. */
  get size(): number {
    this.dropExpired();
    return this.cookies.size;
  }

  /** Fold one response's `Set-Cookie` lines into the jar. */
  store(setCookieLines: readonly string[]): void {
    for (const line of setCookieLines) {
      const parsed = parseSetCookie(line, this.now());
      if (!parsed) continue;
      // Delete first so an overwrite moves the name to the newest position.
      this.cookies.delete(parsed.name);
      if (parsed.expiresAt !== undefined && parsed.expiresAt <= this.now()) {
        continue;
      }
      this.cookies.set(parsed.name, {
        value: parsed.value,
        expiresAt: parsed.expiresAt,
      });
      while (this.cookies.size > MAX_COOKIES) {
        const oldest = this.cookies.keys().next().value;
        /* v8 ignore next -- size > MAX_COOKIES ≥ 1 guarantees a first key */
        if (oldest === undefined) break;
        this.cookies.delete(oldest);
      }
    }
  }

  /**
   * The `Cookie` header value for the live cookies, skipping any name in
   * `exclude` (one the request already carries explicitly), or `undefined`
   * when there is nothing to send.
   */
  cookieHeader(exclude: ReadonlySet<string> = new Set()): string | undefined {
    this.dropExpired();
    const pairs: string[] = [];
    for (const [name, cookie] of this.cookies) {
      if (!exclude.has(name)) pairs.push(`${name}=${cookie.value}`);
    }
    return pairs.length > 0 ? pairs.join("; ") : undefined;
  }

  private dropExpired(): void {
    const now = this.now();
    for (const [name, cookie] of this.cookies) {
      if (cookie.expiresAt !== undefined && cookie.expiresAt <= now) {
        this.cookies.delete(name);
      }
    }
  }
}

/**
 * Wrap `baseFetch` so requests to `serverUrl`'s origin carry the jar's
 * cookies, and responses from that origin feed it. Requests to any other
 * origin pass through untouched in both directions.
 *
 * A `Cookie` header the request already carries (a static custom header from
 * the server settings) is kept, and wins: the jar appends only names it does
 * not already name.
 */
export function createCookieJarFetch(
  baseFetch: typeof fetch,
  serverUrl: URL,
  jar: ConnectionCookieJar,
): typeof fetch {
  const origin = serverUrl.origin;
  return async (input, init) => {
    const url = requestUrl(input);
    if (url?.origin !== origin) return baseFetch(input, init);

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const existing = headers.get("cookie");
    const jarCookies = jar.cookieHeader(cookieNames(existing));
    let response: Response;
    if (jarCookies === undefined) {
      response = await baseFetch(input, init);
    } else {
      headers.set(
        "cookie",
        existing ? `${existing}; ${jarCookies}` : jarCookies,
      );
      response = await baseFetch(input, { ...init, headers });
    }
    jar.store(response.headers.getSetCookie());
    return response;
  };
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL | undefined {
  const raw =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : input;
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

/** The cookie names in an existing `Cookie` header value. */
function cookieNames(header: string | null): Set<string> {
  const names = new Set<string>();
  if (!header) return names;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    const name = (eq === -1 ? pair : pair.slice(0, eq)).trim();
    if (name) names.add(name);
  }
  return names;
}

const UTF8 = new TextEncoder();

interface ParsedSetCookie {
  name: string;
  value: string;
  expiresAt: number | undefined;
}

/**
 * Parse one `Set-Cookie` line, or `undefined` for a malformed one (no `=`, an
 * empty name, or a pair over {@link MAX_COOKIE_BYTES}). Only `Max-Age` and
 * `Expires` are read; every other attribute is ignored (see the module
 * comment).
 */
export function parseSetCookie(
  line: string,
  now: number,
): ParsedSetCookie | undefined {
  const [pair = "", ...attributes] = line.split(";");
  const eq = pair.indexOf("=");
  if (eq === -1) return undefined;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return undefined;
  if (UTF8.encode(`${name}=${value}`).length > MAX_COOKIE_BYTES) {
    return undefined;
  }

  let maxAge: number | undefined;
  let expires: number | undefined;
  for (const attribute of attributes) {
    const attrEq = attribute.indexOf("=");
    if (attrEq === -1) continue;
    const key = attribute.slice(0, attrEq).trim().toLowerCase();
    const attrValue = attribute.slice(attrEq + 1).trim();
    if (key === "max-age" && /^-?\d+$/.test(attrValue)) {
      maxAge = Number(attrValue);
    } else if (key === "expires") {
      const parsed = Date.parse(attrValue);
      if (!Number.isNaN(parsed)) expires = parsed;
    }
  }
  const expiresAt =
    maxAge !== undefined ? (maxAge <= 0 ? now : now + maxAge * 1000) : expires;
  return { name, value, expiresAt };
}
