/**
 * Destination guard for the web backend's `POST /api/fetch` route (#2749).
 *
 * The route is the browser's only way out to the network, and it carries the
 * web client's OAuth traffic — discovery, protected-resource metadata, token,
 * DCR/CIMD, revocation — some of whose URLs come from the server under test.
 * Without a guard, a hostile server can point that traffic at the host's
 * cloud instance-metadata endpoint and read the answer back through the
 * Network log. This is v1's `/fetch` guard (`server/src/proxy-security.ts`
 * and `proxy-redirect.ts` on `v1/main`, #1717 / #1732), ported:
 *
 *  - **Scheme:** `http:` and `https:` only, on every hop.
 *  - **Destinations:** link-local and metadata addresses only —
 *    `169.254.0.0/16`, its IPv4-mapped IPv6 forms, `fe80::/10` and
 *    `fd00:ec2::254`. Loopback and RFC 1918 stay reachable on purpose: local
 *    and LAN MCP servers and authorization servers are legitimate targets.
 *  - **Redirects:** followed here, with `redirect: "manual"`, so each hop is
 *    re-validated. The per-hop rewrite the fetch library used to do moves here
 *    with it ({@link nextRedirectRequest}).
 *
 * ## DNS: checked and pinned in one step
 *
 * v1 resolved the name, validated the result, and then pinned an agent to it.
 * Here the check lives *inside* the connection's own `lookup` hook (undici's
 * `connect.lookup`, handed to `net.connect`): the addresses that hook validates
 * are the addresses the socket connects to, so there is no second resolution
 * for a rebinding name to answer differently. An IP literal never reaches the
 * hook — `net.connect` skips lookup for one — so it is checked before the
 * request instead.
 *
 * ## What the guard can promise behind a proxy
 *
 * When `HTTPS_PROXY` / `HTTP_PROXY` is set the route goes through
 * `createProxyFetch()`, and the **proxy** resolves the name, not us. Scheme,
 * redirect re-validation and IP literals are enforced exactly as above. A
 * hostname is resolved locally as a best-effort check — refused if it resolves
 * to a blocked address here, allowed if it does not resolve here at all (behind
 * a corporate proxy local DNS often cannot see external names) — but it cannot
 * be pinned, and the proxy is free to resolve it differently. In that
 * configuration the proxy is the network boundary, and keeping the metadata
 * service out of reach is its job.
 *
 * ## Out of scope
 *
 * The CLI and TUI make the same OAuth discovery requests directly from Node,
 * without this route. Whether they share the guard is a separate decision.
 */

import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { asUndiciInit, toGlobalResponse } from "../../node/proxyFetch.js";

/** Raised when `/api/fetch` is asked to reach a destination it refuses. */
export class FetchTargetError extends Error {
  override name = "FetchTargetError";
}

/** Hops followed after the first request before giving up, as in v1. */
export const MAX_FETCH_REDIRECTS = 5;

/** The one fetch shape this module calls: a string URL and a full init. */
type HopFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Resolves a hostname to every address it currently has. */
export type ResolveHost = (hostname: string) => Promise<string[]>;

const resolveWithSystemDns: ResolveHost = async (hostname) =>
  (await dnsLookup(hostname, { all: true })).map((r) => r.address);

// ---------------------------------------------------------------------------
// Block-list
// ---------------------------------------------------------------------------

/**
 * Whether `ip` is a link-local or cloud-metadata address that `/api/fetch`
 * must never reach.
 *
 *  - `169.254.0.0/16` (IPv4 link-local; includes the `169.254.169.254` IMDS)
 *  - `::ffff:169.254.x.x` in both its dotted and hex serializations
 *  - `fe80::/10` (IPv6 link-local)
 *  - `fd00:ec2::254` (the AWS IPv6 IMDS)
 *
 * Anything that is not an IP address returns `false`; names are resolved
 * before they are checked.
 */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 169 && b === 254;
  }
  if (kind !== 6) return false;

  const addr = ip.toLowerCase();
  const mapped = /^::ffff:(.+)$/.exec(addr);
  if (mapped) {
    const tail = mapped[1];
    if (isIP(tail) === 4) return isBlockedAddress(tail);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
    if (hex) {
      const high = parseInt(hex[1], 16);
      const low = parseInt(hex[2], 16);
      return isBlockedAddress(
        `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
      );
    }
  }
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10
  return addr === "fd00:ec2::254";
}

/** Throws a {@link FetchTargetError} naming the first blocked address. */
function assertNoneBlocked(addresses: readonly string[]): void {
  const blocked = addresses.find(isBlockedAddress);
  if (blocked !== undefined) {
    throw new FetchTargetError(
      `Refusing to fetch from a link-local or metadata address (${blocked})`,
    );
  }
}

/** `URL.hostname` keeps the brackets around an IPv6 literal. */
function bareHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

// ---------------------------------------------------------------------------
// The pinning lookup hook
// ---------------------------------------------------------------------------

/**
 * A `net.connect` `lookup` hook that resolves with `resolveHost`, refuses the
 * connection if any address is blocked, and otherwise connects to exactly the
 * addresses it just validated.
 *
 * Every address is refused if one is, as in v1, rather than filtering the bad
 * ones out: a name answering with a metadata address is hostile, and handing
 * the socket the rest would only make that harder to notice.
 *
 * Both callback shapes are served. Node's `net.connect` runs with
 * `autoSelectFamily` on by default, which calls the hook with `{ all: true }`
 * and expects an array; the scalar form is the path without it.
 */
export function createPinningLookup(resolveHost: ResolveHost): LookupFunction {
  return (hostname, options, callback) => {
    resolveHost(hostname).then(
      (addresses) => {
        try {
          assertNoneBlocked(addresses);
        } catch (err) {
          callback(err as FetchTargetError, "");
          return;
        }
        const resolved: LookupAddress[] = addresses.map((address) => ({
          address,
          family: isIP(address) === 6 ? 6 : 4,
        }));
        const [first] = resolved;
        if (first === undefined) {
          callback(new FetchTargetError(`Could not resolve ${hostname}`), "");
        } else if (options.all) {
          callback(null, resolved);
        } else {
          callback(null, first.address, first.family);
        }
      },
      (err: NodeJS.ErrnoException) => callback(err, ""),
    );
  };
}

/**
 * One undici `fetch` per resolver, each over a pinned `Agent`, so every
 * request with the system resolver shares one connection pool. Keyed weakly so
 * a resolver a test injects is collected with it.
 */
const directFetches = new WeakMap<ResolveHost, Promise<HopFetch>>();

/** undici is loaded lazily, as `proxyFetch.ts` does, on the first request. */
async function loadDirectFetch(resolveHost: ResolveHost): Promise<HopFetch> {
  const undici = await import("undici");
  const dispatcher = new undici.Agent({
    connect: { lookup: createPinningLookup(resolveHost) },
  });
  return async (url, init) =>
    toGlobalResponse(
      await undici.fetch(url, { ...asUndiciInit(init), dispatcher }),
    );
}

function directFetch(resolveHost: ResolveHost): Promise<HopFetch> {
  let loaded = directFetches.get(resolveHost);
  if (loaded === undefined) {
    loaded = loadDirectFetch(resolveHost);
    directFetches.set(resolveHost, loaded);
  }
  return loaded;
}

// ---------------------------------------------------------------------------
// Redirect hops
// ---------------------------------------------------------------------------

/** Headers that carry credentials and must not cross an origin boundary. */
const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "cookie2",
  "www-authenticate",
]);

/**
 * Headers that describe the request body, dropped with it so a rewritten GET
 * does not announce a body it no longer has (a stale `Content-Length` would
 * leave the upstream waiting for bytes never sent).
 */
const BODY_HEADERS: ReadonlySet<string> = new Set([
  "content-type",
  "content-length",
  "content-encoding",
  "content-language",
  "content-location",
]);

/** One hop's request. */
export interface FetchHopRequest {
  url: URL;
  method: string;
  body: string | undefined;
  headers: Record<string, string>;
}

/**
 * Copies the route's JSON `headers` into a plain string record, ignoring
 * anything that is not a string-valued entry of a plain object.
 */
export function normalizeFetchHeaders(raw: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return headers;
  }
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string") headers[name] = value;
  }
  return headers;
}

function withoutHeaders(
  headers: Record<string, string>,
  names: ReadonlySet<string>,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!names.has(name.toLowerCase())) kept[name] = value;
  }
  return kept;
}

/**
 * Whether the Fetch standard rewrites this redirect into a bodyless GET:
 * 301/302 do so for POST only, 303 for every method except GET and HEAD.
 */
function rewritesToGet(status: number, method: string): boolean {
  const upper = method.toUpperCase();
  if (status === 301 || status === 302) return upper === "POST";
  if (status === 303) return upper !== "GET" && upper !== "HEAD";
  return false;
}

/**
 * The request for the hop after a redirect, following the Fetch standard's
 * "HTTP-redirect fetch" rewrite that taking redirects away from the fetch
 * library also took away:
 *
 *  - **Credentials stay with their origin.** A hop that changes scheme, host
 *    or port drops {@link CREDENTIAL_HEADERS}, compared case-insensitively.
 *  - **Method and body** follow {@link rewritesToGet}; a dropped body takes
 *    {@link BODY_HEADERS} with it.
 *  - **A body never crosses an origin.** A cross-origin hop still carrying a
 *    body after that rewrite — a 307/308 of a POST — is refused, since a
 *    proxied body here is typically an OAuth form holding a refresh token or
 *    client secret.
 *
 * Returns a fresh headers object every hop, so the caller's input is never
 * mutated and a header dropped on one hop cannot reappear on a later one. The
 * returned URL has still to pass the guard before it is fetched.
 */
export function nextRedirectRequest(
  current: FetchHopRequest,
  status: number,
  location: string,
): FetchHopRequest {
  const url = new URL(location, current.url);
  let { method, body } = current;
  let headers = { ...current.headers };
  const crossOrigin = url.origin !== current.url.origin;

  if (crossOrigin) headers = withoutHeaders(headers, CREDENTIAL_HEADERS);
  if (rewritesToGet(status, method)) {
    method = "GET";
    body = undefined;
    headers = withoutHeaders(headers, BODY_HEADERS);
  }
  // `!= null`: the body arrives as JSON, so "no body" can be null as well as
  // undefined. An empty string is still a body the caller chose to send.
  if (crossOrigin && body != null) {
    throw new FetchTargetError(
      "Refusing to follow a cross-origin redirect for a request with a body",
    );
  }
  return { url, method, body, headers };
}

// ---------------------------------------------------------------------------
// The guarded fetch
// ---------------------------------------------------------------------------

/** The request `/api/fetch` was asked to make. */
export interface GuardedFetchInit {
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  signal: AbortSignal;
}

export interface GuardedFetchOptions {
  /**
   * The proxy-aware fetch from `createProxyFetch()`, when a proxy is
   * configured. Its presence is what switches the guard to the best-effort
   * mode described in the module header.
   */
  proxyFetch?: typeof fetch;
  /** Overrides the system resolver. For tests. */
  resolveHost?: ResolveHost;
}

/**
 * Checks `url` before it is requested. The scheme and an IP literal are
 * checked on every path; a hostname is checked here only behind a proxy, since
 * on the direct path the pinning lookup checks it as the socket connects.
 */
async function assertAllowedTarget(
  url: URL,
  resolveHost: ResolveHost,
  viaProxy: boolean,
): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchTargetError(
      `Refusing to fetch a ${url.protocol} URL; only http and https are allowed`,
    );
  }
  const host = bareHost(url);
  if (isIP(host)) {
    assertNoneBlocked([host]);
    return;
  }
  if (!viaProxy) return;
  let addresses: string[];
  try {
    addresses = await resolveHost(host);
  } catch {
    // Not resolvable here is normal behind a proxy; the proxy resolves it.
    return;
  }
  assertNoneBlocked(addresses);
}

/**
 * `fetch(url, init)` for `/api/fetch`, with every hop checked against the
 * destination guard.
 *
 * Rejects with a {@link FetchTargetError} — directly, or as the `cause` of the
 * fetch library's own `TypeError` when the pinning lookup refused the
 * connection; {@link findFetchTargetError} finds it either way.
 */
export async function guardedFetch(
  url: string,
  init: GuardedFetchInit,
  options: GuardedFetchOptions = {},
): Promise<Response> {
  const resolveHost = options.resolveHost ?? resolveWithSystemDns;
  const viaProxy = options.proxyFetch !== undefined;
  const fetchFn: HopFetch =
    options.proxyFetch ?? (await directFetch(resolveHost));

  let request: FetchHopRequest = {
    url: new URL(url),
    method: init.method,
    body: init.body,
    headers: init.headers,
  };
  for (let hop = 0; hop <= MAX_FETCH_REDIRECTS; hop++) {
    await assertAllowedTarget(request.url, resolveHost, viaProxy);
    const res = await fetchFn(request.url.href, {
      method: request.method,
      headers: new Headers(request.headers),
      body: request.body,
      signal: init.signal,
      redirect: "manual",
    });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || location === null) {
      return res;
    }
    // Nobody reads a redirect's body. Not awaited, for the reason the route
    // gives on its own stream cancel: `cancel()` may never settle.
    void res.body?.cancel().catch(() => {});
    request = nextRedirectRequest(request, res.status, location);
  }
  throw new FetchTargetError(
    `Refusing to follow more than ${MAX_FETCH_REDIRECTS} redirects`,
  );
}

/**
 * The {@link FetchTargetError} behind `err`, if any. undici reports a refused
 * connection as `TypeError("fetch failed")` with the lookup's error as its
 * `cause`, so the chain is walked rather than `err` alone tested.
 */
export function findFetchTargetError(
  err: unknown,
): FetchTargetError | undefined {
  let current = err;
  // Bounded, in case a cause chain is ever cyclic.
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current instanceof FetchTargetError) return current;
    current = current.cause;
  }
  return undefined;
}
