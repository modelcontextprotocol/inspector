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
 *
 * Deployments that serve the client and the proxy from one origin (a single
 * reverse proxy routing by path) can opt out with
 * `DANGEROUSLY_ALLOW_SAME_ORIGIN_API=true`.
 */

import type { IncomingHttpHeaders } from "node:http";

export function isSameOriginBrowserRequest(
  headers: IncomingHttpHeaders,
): boolean {
  // Browsers set this header themselves and page script cannot override it
  // (Sec-* names are forbidden request headers).
  return headers["sec-fetch-site"]?.trim().toLowerCase() === "same-origin";
}

const TRUTHY_FLAG_VALUES = new Set(["true", "1", "yes"]);

/**
 * Parses the value of `DANGEROUSLY_ALLOW_SAME_ORIGIN_API`.
 *
 * Only an explicit truthy value (`true`, `1` or `yes`, case-insensitive,
 * surrounding whitespace ignored) disables the same-origin check. Anything
 * else (unset, empty, `false`, `0`, or an unrecognized value) keeps it
 * enforcing. This deliberately mirrors the accepted set of the strict
 * `DANGEROUSLY_OMIT_AUTH` parse (`isAuthDisabledFlag`); the two are separate
 * copies until they can share one helper, so keep them in sync.
 */
export function isSameOriginApiAllowedFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  return TRUTHY_FLAG_VALUES.has(value.trim().toLowerCase());
}

/**
 * Whether an API request must be rejected: it is a same-origin browser
 * request and the opt-out is not enabled.
 */
export function shouldRejectSameOriginRequest(
  headers: IncomingHttpHeaders,
  allowSameOriginApi: boolean,
): boolean {
  return !allowSameOriginApi && isSameOriginBrowserRequest(headers);
}
