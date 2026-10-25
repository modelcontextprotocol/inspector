/**
 * Destination guard for the OAuth requests every Node client makes (#2749).
 *
 * OAuth discovery, protected-resource metadata, token, DCR/CIMD and revocation
 * URLs come partly from the server under test. Without a guard, a hostile
 * server can point that traffic at the host's cloud instance-metadata endpoint
 * and read the answer back — through the web client's Network log, or a CLI's
 * error output. This is v1's `/fetch` guard (`server/src/proxy-security.ts`
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
 * ## Where it applies
 *
 * To OAuth traffic only, never to the MCP endpoint a user configured.
 *
 *  - The web backend's `POST /api/fetch` ({@link guardedFetch}), which carries
 *    every OAuth request the browser makes.
 *  - `InspectorClientEnvironment.oauthFetch` ({@link createGuardedFetch}),
 *    which the CLI, TUI and mcpdo fill. `InspectorClient` routes the
 *    transport chain's non-MCP requests there too (`routeOAuthRequests`), so
 *    the discovery the SDK runs from inside a transport on a 401 or a refresh
 *    is covered as well.
 *  - The web backend's own transport (`createTransportNode`), routed the same
 *    way, since the SDK refreshes there with the tokens the browser handed it.
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
 * When `HTTPS_PROXY` / `HTTP_PROXY` is set the request goes through undici's
 * `EnvHttpProxyAgent`, built with the same pinning lookup. That agent hands
 * `connect` to its `NO_PROXY` agent only — `ProxyAgent` builds its connectors
 * from `proxyTls` / `requestTls` — so a host that bypasses the proxy is pinned
 * exactly as on the direct path, and the proxy's own address is not checked.
 *
 * A proxied host is resolved by the **proxy**, not by us. Scheme, redirect
 * re-validation and IP literals are enforced as above, and the hostname is
 * resolved locally as a best-effort check — refused if it resolves to a
 * blocked address here, allowed if it does not resolve here at all (behind a
 * corporate proxy local DNS often cannot see external names) — but the proxy
 * is free to resolve it differently. For that traffic the proxy is the network
 * boundary, and keeping the metadata service out of reach is its job.
 */

import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import type { Dispatcher } from "undici";
import {
  callerSignalOf,
  requestHeadersOf,
  requestUrlOf,
} from "../../auth/requestTimeout.js";
import { asUndiciInit, readProxyEnv, toGlobalResponse } from "./proxyFetch.js";

/** Raised when a guarded fetch is asked to reach a destination it refuses. */
export class FetchTargetError extends Error {
  override name = "FetchTargetError";
}

/** Hops followed after the first request before giving up, as in v1. */
export const MAX_FETCH_REDIRECTS = 5;

/**
 * The statuses the Fetch standard follows. Any other 3xx — a 300 Multiple
 * Choices, a 304 Not Modified — is a response, Location or not, and is
 * relayed as one, as the fetch this guard replaced did.
 */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

/** The one fetch shape this module calls: a string URL and a full init. */
export type HopFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Resolves a hostname to every address it currently has. */
export type ResolveHost = (hostname: string) => Promise<string[]>;

const resolveWithSystemDns: ResolveHost = async (hostname) =>
  (await dnsLookup(hostname, { all: true })).map((r) => r.address);

// ---------------------------------------------------------------------------
// Block-list
// ---------------------------------------------------------------------------

/**
 * Whether `ip` is a link-local or cloud-metadata address that a guarded fetch
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
 * One undici `fetch` per resolver and proxy setting, each over a dispatcher
 * built with the pinning lookup, so every request with the system resolver
 * shares one connection pool. Keyed weakly on the resolver so one a test
 * injects is collected with it; keyed on the proxy URL because
 * `EnvHttpProxyAgent` captures it at construction.
 */
const hopFetches = new WeakMap<ResolveHost, Map<string, Promise<HopFetch>>>();

/** undici is loaded lazily, as `proxyFetch.ts` does, on the first request. */
async function loadHopFetch(
  resolveHost: ResolveHost,
  proxied: boolean,
): Promise<HopFetch> {
  const undici = await import("undici");
  const connect = { lookup: createPinningLookup(resolveHost) };
  const dispatcher: Dispatcher = proxied
    ? new undici.EnvHttpProxyAgent({ connect })
    : new undici.Agent({ connect });
  return async (url, init) =>
    toGlobalResponse(
      await undici.fetch(url, { ...asUndiciInit(init), dispatcher }),
    );
}

function hopFetchFor(
  resolveHost: ResolveHost,
  proxyUrl: string | undefined,
): Promise<HopFetch> {
  let byProxy = hopFetches.get(resolveHost);
  if (byProxy === undefined) {
    byProxy = new Map();
    hopFetches.set(resolveHost, byProxy);
  }
  const key = proxyUrl ?? "";
  let loaded = byProxy.get(key);
  if (loaded === undefined) {
    loaded = loadHopFetch(resolveHost, proxyUrl !== undefined);
    byProxy.set(key, loaded);
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
 *    request body here is typically an OAuth form holding a refresh token or
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

/** The request a guarded fetch was asked to make. */
export interface GuardedFetchInit {
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  signal?: AbortSignal;
}

export interface GuardedFetchOptions {
  /** Overrides the system resolver. For tests. */
  resolveHost?: ResolveHost;
  /**
   * Overrides the fetch each hop is made with, which otherwise is undici over
   * the pinning lookup. For tests of the hop loop, which then needs no socket.
   */
  hopFetch?: HopFetch;
  /**
   * Whether a proxy is in play, which switches hostnames to the best-effort
   * local check described in the module header. Read from the environment
   * when absent; set only by tests.
   */
  viaProxy?: boolean;
}

/**
 * `resolveHost(host)`, rejecting with the signal's reason as soon as it
 * aborts. A local resolver that stalls must not hold a cancelled or timed-out
 * request open — the signal otherwise only reaches the fetch after it.
 */
function resolveUnlessAborted(
  resolveHost: ResolveHost,
  host: string,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  if (signal === undefined) return resolveHost(host);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    resolveHost(host).then(
      (addresses) => {
        signal.removeEventListener("abort", onAbort);
        resolve(addresses);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Checks `url` before it is requested. The scheme and an IP literal are
 * checked on every path; a hostname is checked here only behind a proxy, since
 * otherwise the pinning lookup checks it as the socket connects.
 */
async function assertAllowedTarget(
  url: URL,
  resolveHost: ResolveHost,
  viaProxy: boolean,
  signal: AbortSignal | undefined,
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
    addresses = await resolveUnlessAborted(resolveHost, host, signal);
  } catch (err) {
    // An abort is the caller giving up, and propagates as one.
    if (signal?.aborted) throw err;
    // Not resolvable here is normal behind a proxy; the proxy resolves it.
    return;
  }
  assertNoneBlocked(addresses);
}

/**
 * `fetch(url, init)` with every hop checked against the destination guard.
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
  const proxyUrl = readProxyEnv();
  const viaProxy = options.viaProxy ?? proxyUrl !== undefined;
  const fetchFn: HopFetch =
    options.hopFetch ?? (await hopFetchFor(resolveHost, proxyUrl));

  let request: FetchHopRequest = {
    url: new URL(url),
    method: init.method,
    body: init.body,
    headers: init.headers,
  };
  for (let hop = 0; hop <= MAX_FETCH_REDIRECTS; hop++) {
    await assertAllowedTarget(request.url, resolveHost, viaProxy, init.signal);
    const res = await fetchFn(request.url.href, {
      method: request.method,
      headers: new Headers(request.headers),
      body: request.body,
      signal: init.signal,
      redirect: "manual",
    });
    const location = res.headers.get("location");
    if (!REDIRECT_STATUSES.has(res.status) || location === null) {
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

/**
 * A request body as the guard's string form. OAuth sends a string (JSON for
 * DCR) or a `URLSearchParams` form (token, revocation), and both are
 * replayable across a redirect hop, which a stream is not. Anything else is
 * refused loudly rather than silently mangled.
 */
async function bodyText(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<string | undefined> {
  const body =
    init?.body !== undefined
      ? init.body
      : input instanceof Request && input.body !== null
        ? await input.clone().text()
        : undefined;
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new TypeError(
    "A guarded fetch takes a string or URLSearchParams body only",
  );
}

/**
 * The guard as an ordinary `fetch`, for `InspectorClientEnvironment.oauthFetch`
 * and the Node clients' standalone OAuth calls.
 *
 * It replaces `createProxyFetch()` on those paths rather than wrapping it: it
 * reads the same proxy variables and routes through the same `EnvHttpProxyAgent`
 * class, built with the pinning lookup (see the module header).
 *
 * A refusal rejects with the {@link FetchTargetError} itself rather than
 * undici's generic `fetch failed`, so a CLI prints why.
 */
export function createGuardedFetch(
  options: GuardedFetchOptions = {},
): typeof fetch {
  return async (input, init) => {
    const headers = Object.fromEntries(requestHeadersOf(input, init));
    const body = await bodyText(input, init);
    // `fetch` sets this itself for a `URLSearchParams` body; a string does not.
    if (
      init?.body instanceof URLSearchParams &&
      !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")
    ) {
      headers["content-type"] =
        "application/x-www-form-urlencoded;charset=UTF-8";
    }
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    try {
      return await guardedFetch(
        requestUrlOf(input),
        { method, headers, body, signal: callerSignalOf(input, init) },
        options,
      );
    } catch (err) {
      throw findFetchTargetError(err) ?? err;
    }
  };
}
