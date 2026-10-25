/**
 * Split one fetch chain into MCP traffic and OAuth work (#2749).
 *
 * A transport's fetch carries both: the MCP endpoint's own requests, and the
 * OAuth discovery, token and registration requests the SDK runs from inside
 * the transport on a 401 or a refresh. The two need different bases — OAuth
 * goes through the destination guard (`core/mcp/node/fetchGuard.ts`), while
 * the MCP endpoint is the server the user configured and is never second-
 * guessed — so this sends each request to one or the other.
 *
 * The classification is `exemptMcpEndpoint`'s, the same predicate that keeps
 * the MCP endpoint out of the OAuth deadline, with one override ahead of it:
 * a well-known URI ({@link isWellKnownUri}) is always OAuth. Legacy SSE widens
 * that predicate's exemption to the server's whole origin, so without the
 * override a hostile SSE server's own `/.well-known/oauth-protected-resource`
 * would go out unguarded and could redirect discovery to the metadata service
 * (Copilot). Otherwise the predicate fails open toward MCP when it cannot
 * tell, which here means unguarded: those cases are requests on the configured
 * server's own origin, which the user chose.
 *
 * Isomorphic — it only picks between two fetches it is handed — so
 * `InspectorClient` can use it in the browser as well as in Node.
 */

import { requestHeadersOf, requestUrlOf } from "./requestTimeout.js";

/**
 * Whether `url` is an RFC 8615 well-known URI — OAuth and OIDC discovery,
 * never MCP traffic. Matched anywhere in the path, not only as a prefix, for
 * the OIDC discovery form that appends it to an issuer's path
 * (`/tenant/.well-known/openid-configuration`).
 */
export function isWellKnownUri(url: string): boolean {
  try {
    return new URL(url).pathname.includes("/.well-known/");
  } catch {
    return false;
  }
}

/**
 * A fetch that sends MCP-endpoint requests to `mcpFetch` and everything else
 * to `oauthFetch`.
 *
 * @param isMcpEndpoint - `exemptMcpEndpoint(...)`, or any predicate of the
 *   same shape; `true` means MCP traffic.
 */
export function routeOAuthRequests(
  mcpFetch: typeof fetch,
  oauthFetch: typeof fetch,
  isMcpEndpoint: (url: string, headers: Headers) => boolean,
): typeof fetch {
  return (input, init) => {
    const url = requestUrlOf(input);
    return !isWellKnownUri(url) &&
      isMcpEndpoint(url, requestHeadersOf(input, init))
      ? mcpFetch(input, init)
      : oauthFetch(input, init);
  };
}
