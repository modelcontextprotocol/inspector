/**
 * Apply a transport's configured headers to requests for the MCP server's own
 * origin, and to no other (#3018).
 *
 * `createTransportNode` used to hand the server's custom headers to the SDK
 * transport as `requestInit.headers`. The transport reads them there for its
 * MCP requests — and also builds the fetch for the OAuth work it runs itself
 * (the discovery and token refresh behind a 401, when an `authProvider` is
 * attached) by merging the whole `requestInit` into every request, whatever
 * its destination. An authorization server on another origin — one the server
 * under test named in its protected-resource metadata, not one the user
 * configured — therefore received headers that routinely hold credentials for
 * the MCP server (`X-API-Key`).
 *
 * So the headers are kept out of `requestInit` and added here instead, on the
 * fetch the transport is given, which every request it makes passes through.
 * This is the rule `core/auth/serverOriginHeaders.ts` set for the OAuth
 * requests the Inspector makes itself (#2985), applied to the ones the SDK
 * makes.
 *
 * It deliberately does not reuse that helper, whose job is narrower: it adds
 * headers to OAuth requests only, and so never adds `Authorization` or
 * `Cookie`. This wrapper also carries the MCP requests themselves, where a
 * custom `Authorization` is exactly what must be sent. It reproduces what
 * `requestInit.headers` did for the server's origin and changes nothing else:
 *
 *  - **The request's own headers win**, case-insensitively. The SDK seeded its
 *    MCP request headers from `requestInit.headers` and then set its own on
 *    top (the OAuth token, `MCP-Protocol-Version`, `Mcp-Session-Id`, `Accept`,
 *    `Content-Type`); for its OAuth requests the per-request headers replaced
 *    the configured ones the same way. Laying the configured headers
 *    underneath the request's gives the same result in both cases.
 *  - **An illegal header still fails the request.** `new Headers` throws in
 *    Node on a name or value it rejects, as it did inside the SDK, so the user
 *    is still told on the MCP request rather than having the row dropped.
 *
 * It belongs outermost on the transport's fetch chain, so every layer below —
 * the cookie jar, the Network tracker — sees the headers actually sent, as
 * they did when the SDK supplied them.
 */

import { requestUrlOf } from "../../auth/requestTimeout.js";

/**
 * Wrap `fetchFn` so a request to `origin` is sent with `headers` underneath
 * its own. A request to any other origin — or every request, when there are
 * no headers to add — is passed through untouched.
 *
 * @param origin - the MCP server's origin (`new URL(serverUrl).origin`).
 * @param headers - the transport's configured headers, in any `HeadersInit`
 *   form; `undefined` disables the wrapper.
 */
export function createOriginScopedHeadersFetch(
  fetchFn: typeof fetch,
  origin: string,
  headers: HeadersInit | undefined,
): typeof fetch {
  // An opaque origin serializes as "null" and would compare equal to any
  // other opaque origin; neither is an HTTP server, so it never matches.
  if (headers === undefined || origin === "null") return fetchFn;

  return async (input, init) => {
    let requestOrigin: string | undefined;
    try {
      requestOrigin = new URL(requestUrlOf(input)).origin;
    } catch {
      // Not an absolute URL: leave it for the underlying fetch to reject.
      requestOrigin = undefined;
    }
    if (requestOrigin !== origin) return fetchFn(input, init);

    const merged = new Headers(headers);
    // `init.headers` replaces a `Request`'s own, matching `fetch`.
    const own = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    own.forEach((value, name) => {
      merged.set(name, value);
    });
    return fetchFn(input, { ...init, headers: merged });
  };
}
