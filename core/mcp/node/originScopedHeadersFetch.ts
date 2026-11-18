/**
 * Keep a transport's configured headers on the MCP server's own origin
 * (#3018).
 *
 * `createTransportNode` hands the server's custom headers to the SDK transport
 * as `requestInit.headers`. The transport reads them there for its MCP
 * requests — and also builds the fetch for the OAuth work it runs itself (the
 * discovery and token refresh behind a 401, when an `authProvider` is
 * attached) by merging the whole `requestInit` into every request, whatever
 * its destination. An authorization server on another origin — one the server
 * under test named in its protected-resource metadata, not one the user
 * configured — therefore received headers that routinely hold credentials for
 * the MCP server (`X-API-Key`).
 *
 * This wrapper sits on the fetch the transport is given and takes those
 * headers back off any request that leaves the server's origin. It is the rule
 * `core/auth/serverOriginHeaders.ts` set for the OAuth requests the Inspector
 * makes itself (#2985), applied to the ones the SDK makes.
 *
 * **Why remove rather than add.** Leaving the headers out of `requestInit` and
 * adding them here to same-origin requests would be the tidier shape, and it
 * is wrong: the SDK does more with `requestInit.headers` than send them. It
 * unions a configured `Accept` with the media types it requires, and deletes a
 * configured `Mcp-Session-Id` from the handshake — neither of which a wrapper
 * below the SDK can reproduce without mirroring its internals. So the MCP
 * requests are left exactly as the SDK builds them, and only the requests that
 * must not carry the headers are touched.
 *
 * **What is removed.** The SDK's merge is `{ ...configured, ...own }`, so by
 * the time a request arrives here its own headers and the configured ones are
 * one set. A configured header is taken off when the request still carries
 * the configured value — that is, when the request did not set that name
 * itself. Two cases need care:
 *
 *  - **The request set the same name in another case** (`accept` against a
 *    configured `Accept`). Both keys survive the SDK's merge and `Headers`
 *    joins them, configured value first; the configured part is cut off and
 *    the request's own value kept.
 *  - **{@link CROSS_ORIGIN_HEADERS} and `Content-Type` are left alone.** These
 *    are content negotiation and framing, which an OAuth request sets for
 *    itself and which say nothing about the user — the same list the
 *    destination guard keeps on a cross-origin redirect hop. Leaving them
 *    means a request whose own `Content-Type` happens to equal a configured
 *    one is never sent without it.
 */

import { requestHeadersOf, requestUrlOf } from "../../auth/requestTimeout.js";
import { CROSS_ORIGIN_HEADERS } from "./fetchGuard.js";

/** Whether a configured header of this name stays on a request to another origin. */
function staysCrossOrigin(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "content-type" || CROSS_ORIGIN_HEADERS.has(lower);
}

/**
 * Wrap `fetchFn` so a request to any origin other than `origin` is sent
 * without the transport's configured `headers`. A request to `origin` — or
 * every request, when no headers are configured — is passed through untouched.
 *
 * @param origin - the MCP server's origin (`new URL(serverUrl).origin`).
 * @param headers - the transport's `requestInit.headers`, in any `HeadersInit`
 *   form.
 */
export function createOriginScopedHeadersFetch(
  fetchFn: typeof fetch,
  origin: string,
  headers: HeadersInit | undefined,
): typeof fetch {
  if (headers === undefined) return fetchFn;

  return async (input, init) => {
    let requestOrigin: string;
    try {
      requestOrigin = new URL(requestUrlOf(input)).origin;
    } catch {
      // Not an absolute URL: leave it for the underlying fetch to reject.
      return fetchFn(input, init);
    }
    if (requestOrigin === origin) return fetchFn(input, init);

    const sent = requestHeadersOf(input, init);
    let changed = false;
    // Through `Headers`, so names compare case-insensitively and values are
    // normalized the same way on both sides.
    new Headers(headers).forEach((value, name) => {
      if (staysCrossOrigin(name)) return;
      const current = sent.get(name);
      if (current === value) {
        sent.delete(name);
        changed = true;
      } else if (current?.startsWith(`${value}, `)) {
        sent.set(name, current.slice(value.length + 2));
        changed = true;
      }
    });
    return changed
      ? fetchFn(input, { ...init, headers: sent })
      : fetchFn(input, init);
  };
}
