/**
 * The Node-request → Fetch-`Request` half of the Vite dev plugin's `/api`
 * bridge, factored out of `vite-hono-plugin.ts` (which is coverage-excluded
 * runtime glue) so it can be tested directly.
 *
 * It exists as its own module because of TLS (#2446): with `server.https` set,
 * Vite serves HTTP/2 (falling back to HTTP/1.1 for clients that don't
 * negotiate it), and an HTTP/2 request differs from an HTTP/1.1 one in two
 * ways the original inline code did not survive:
 *
 * - its headers include the pseudo-headers `:method`, `:scheme`, `:authority`
 *   and `:path`, which `Headers.set` rejects as invalid names — so copying
 *   them verbatim threw and every `/api/*` call failed;
 * - it carries no `host` header; the authority is in `:authority`.
 *
 * And on the way back, HTTP/2 forbids connection-specific response headers
 * (`Connection`, `Keep-Alive`, `Transfer-Encoding`, …); Node drops them with
 * an `UnsupportedWarning` per request, so the bridge skips them instead.
 */

import type { IncomingHttpHeaders } from "node:http";

/** The request URL Hono sees, with the listener's real scheme and authority. */
export function fetchUrlForNodeRequest(
  headers: IncomingHttpHeaders,
  pathname: string,
  scheme: "http" | "https",
): string {
  const authority = headers.host ?? headers[":authority"];
  return `${scheme}://${authority}${pathname}`;
}

/** Copy a Node request's headers into Fetch `Headers`, minus HTTP/2 pseudo-headers. */
export function fetchHeadersFromNode(headers: IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (!value || key.startsWith(":")) continue;
    out.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return out;
}

const CONNECTION_SPECIFIC_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Whether a response header may be set on a response of this HTTP major
 * version. Everything is allowed on HTTP/1.x; HTTP/2 refuses the
 * connection-specific headers (RFC 9113 §8.2.2).
 */
export function isResponseHeaderAllowed(
  name: string,
  httpVersionMajor: number,
): boolean {
  return (
    httpVersionMajor < 2 || !CONNECTION_SPECIFIC_HEADERS.has(name.toLowerCase())
  );
}
