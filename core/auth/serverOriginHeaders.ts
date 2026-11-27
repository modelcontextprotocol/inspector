/**
 * Carry a server's custom headers onto the OAuth requests that go to that
 * server's own origin (#2985).
 *
 * Custom headers (`InspectorServerSettings.headers`) are handed to the
 * transport, so they reach the MCP endpoint — but the OAuth requests the
 * Inspector makes itself (protected-resource and authorization-server
 * discovery, dynamic client registration, the code exchange, refresh,
 * revocation) run on a separate fetch chain that never saw them. A deployment
 * that routes by header — `X-Environment: staging` selecting a tenant on one
 * hostname — then served the MCP endpoint from the intended environment and
 * the OAuth endpoints beside it from the default one.
 *
 * The scope is deliberately the **MCP server's own origin and nothing else**:
 *
 *  - That origin already receives every one of these headers on each MCP
 *    request, so sending them to another path on it discloses nothing new.
 *  - Any other origin is one the *server* named — in its protected-resource
 *    metadata, or in an authorization server's metadata — not one the user
 *    configured. Custom headers routinely hold credentials for the MCP server
 *    (`X-API-Key`), and forwarding them to a destination the server under test
 *    chose would hand it a way to send them anywhere. A cross-origin
 *    authorization server therefore gets none of them.
 *
 * Within that origin two more rules hold:
 *
 *  - **The request's own headers win.** A header the caller already set (the
 *    SDK's `Content-Type` and `Accept`, its `Authorization: Basic` client
 *    authentication, `MCP-Protocol-Version`) is never replaced.
 *  - **{@link RESERVED_HEADERS} are never added.** A custom `Authorization` or
 *    `Cookie` authenticates the user to the MCP endpoint; on a token request
 *    it would read as a second client-authentication method, which RFC 6749
 *    §2.3 forbids. The rest are framing and content negotiation that belong to
 *    each request.
 *
 * A redirect is the one way a request leaves the origin it was sent to. The
 * destination guard follows redirects itself and keeps only negotiation
 * headers on a hop to another origin (`nextRedirectRequest` in
 * `core/mcp/node/fetchGuard.ts`), so a header added here never follows one.
 *
 * Isomorphic — it only decorates the `init` it passes on — so
 * `InspectorClient` uses it in the browser as well as in Node.
 */

import {
  deadlineForRequestInit,
  requestHeadersOf,
  requestUrlOf,
  stampRequestDeadline,
} from "./requestTimeout.js";

/** One custom-header row, as `InspectorServerSettings.headers` stores it. */
export interface CustomHeaderRow {
  key: string;
  value: string;
}

/**
 * Custom headers that are never copied onto an OAuth request, compared
 * case-insensitively: credentials for the MCP endpoint, and per-request
 * framing / content negotiation.
 */
export const RESERVED_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "cookie2",
  "host",
  "connection",
  "accept",
  "content-type",
  "content-length",
  "content-encoding",
  "transfer-encoding",
]);

/**
 * A legal header name (RFC 9110 `token`) and the characters a value may not
 * hold. Checked here rather than left to `Headers.set`, which throws on a bad
 * row in Node and silently accepts it in some other runtimes: a row that is
 * blank or illegal is skipped. The transport rejects the same row on the MCP
 * request, which is where the user is told; an OAuth request is simply sent
 * without it.
 */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const FORBIDDEN_IN_VALUE = /[\0\r\n]/;

/** The origin of `url`, or `undefined` when it does not parse as a URL. */
function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * Wrap `fetchFn` so a request to the MCP server's own origin carries the
 * server's custom headers.
 *
 * Both getters are called per request rather than captured once: settings are
 * replaced live on a save, and reading them lazily means the wrapper never
 * serves a stale header set. With no custom headers, an unresolvable server
 * URL, or a request to any other origin, the call is passed through untouched.
 *
 * @param getServerUrl - the MCP server's URL; may throw or return `undefined`
 *   when there is none (a stdio server), which disables the wrapper.
 * @param getHeaders - the server's custom-header rows.
 */
export function withServerOriginHeaders(
  fetchFn: typeof fetch,
  getServerUrl: () => string | undefined,
  getHeaders: () => readonly CustomHeaderRow[] | undefined,
): typeof fetch {
  const serverOrigin = (): string | undefined => {
    try {
      const url = getServerUrl();
      return url === undefined ? undefined : originOf(url);
    } catch {
      return undefined;
    }
  };

  return (input, init) => {
    const rows = getHeaders();
    if (!rows || rows.length === 0) return fetchFn(input, init);
    const origin = serverOrigin();
    // An opaque origin serializes as "null", which would compare equal to
    // another opaque origin; neither is an HTTP server, so it never matches.
    if (
      origin === undefined ||
      origin === "null" ||
      originOf(requestUrlOf(input)) !== origin
    ) {
      return fetchFn(input, init);
    }

    // Collected first, last row winning, so a duplicated name resolves the way
    // it does on the MCP request (the transport builds a record from the same
    // rows) — and only then weighed against the request's own headers.
    const custom = new Map<string, [name: string, value: string]>();
    for (const { key, value } of rows) {
      const name = key.trim();
      if (!HEADER_NAME.test(name) || FORBIDDEN_IN_VALUE.test(value)) continue;
      const lower = name.toLowerCase();
      if (!RESERVED_HEADERS.has(lower)) custom.set(lower, [name, value]);
    }
    const headers = requestHeadersOf(input, init);
    let added = false;
    for (const [name, value] of custom.values()) {
      if (headers.has(name)) continue;
      headers.set(name, value);
      added = true;
    }
    if (!added) return fetchFn(input, init);

    const nextInit: RequestInit = { ...init, headers };
    // The deadline `withOAuthRequestTimeout` stamped is keyed on the init
    // object, which this replaces — carry it over, or the browser's proxy hop
    // would lose its independent timeout.
    const deadline = deadlineForRequestInit(init);
    if (deadline !== undefined) stampRequestDeadline(nextInit, deadline);
    return fetchFn(input, nextInit);
  };
}
