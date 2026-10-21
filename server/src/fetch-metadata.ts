/**
 * Fetch-metadata check for the proxy's API routes.
 *
 * The Inspector client is always served from a different origin than the
 * proxy (its own port, `CLIENT_PORT`, default 6274, versus `SERVER_PORT`,
 * default 6277), so a legitimate browser request to an API route is never
 * `Sec-Fetch-Site: same-origin`. The only documents the proxy itself serves
 * are the MCP Apps sandbox (`/sandbox`) and the untrusted app HTML it hosts in
 * an inner frame, which inherits that origin. Those documents have no reason
 * to call the API routes, and because a same-origin request carries no
 * `Origin` header, the origin allow-list cannot stop them. This check does.
 *
 * Non-browser callers (the CLI, curl, node fetch) send no `Sec-Fetch-Site`
 * header and are unaffected. `same-site` is deliberately allowed: ports do not
 * count toward a site, so the real client on `localhost:6274` calling the
 * proxy on `localhost:6277` is `same-site`.
 */

import type { IncomingHttpHeaders } from "node:http";

export function isSameOriginBrowserRequest(
  headers: IncomingHttpHeaders,
): boolean {
  // Browsers set this header themselves and page script cannot override it
  // (Sec-* names are forbidden request headers).
  return headers["sec-fetch-site"]?.trim().toLowerCase() === "same-origin";
}
