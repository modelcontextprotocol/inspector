import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/client";
import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/client";
import { parseHttpUrl } from "./utils.js";

type AuthorizationServerMetadata = Awaited<
  ReturnType<typeof discoverAuthorizationServerMetadata>
>;

/**
 * The MCP server's own URL, used as the authorization server when RFC 9728
 * protected-resource metadata named none.
 *
 * The path is kept. Reducing it to the origin (`new URL("/", serverUrl)`)
 * discards exactly the part that tells discovery where to look when the server
 * is not hosted at the domain root: the SDK's `buildDiscoveryUrls` derives the
 * path-scoped well-known locations — `/.well-known/oauth-authorization-server{path}`
 * and `{path}/.well-known/openid-configuration` — from this URL's pathname, so
 * an origin-only value can only ever probe the domain root (#2110).
 *
 * Query and fragment are stripped: an RFC 8414 issuer identifier carries
 * neither, and the SDK compares the discovered `issuer` against this URL.
 */
function serverUrlAsAuthorizationServer(serverUrl: string): URL {
  try {
    const url = new URL(serverUrl);
    url.search = "";
    url.hash = "";
    return url;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid MCP server URL: "${serverUrl}" (${detail})`, {
      cause: err,
    });
  }
}

/**
 * Returns the URL to use for OAuth authorization server metadata discovery.
 * Uses resource metadata's authorization_servers[0] when present, otherwise the MCP server URL.
 */
export function getAuthorizationServerUrl(
  serverUrl: string,
  resourceMetadata?: OAuthProtectedResourceMetadata | null,
): URL {
  const first = resourceMetadata?.authorization_servers?.[0];
  // Empty string falls back to serverUrl
  if (first) {
    return parseHttpUrl(first, "protected resource authorization_servers[0]");
  }
  return serverUrlAsAuthorizationServer(serverUrl);
}

/**
 * The authorization-server URLs to try, in order.
 *
 * When protected-resource metadata names an authorization server there is
 * exactly one candidate — the server told us where to look, and probing past it
 * would be guessing. Otherwise the MCP server URL itself stands in as the
 * authorization server, and a path-hosted server has two plausible answers: the
 * full URL, whose path-scoped well-known locations are what a server like
 * `https://example.com/mod/minilesson/mcp.php` publishes, and the bare origin,
 * used by a server that merely *lives* under a path while publishing its
 * metadata at the domain root. Trying the path-scoped form first fixes #2110
 * without regressing the root-hosted case, which is all the origin-only value
 * ever served.
 */
export function getAuthorizationServerUrlCandidates(
  serverUrl: string,
  resourceMetadata?: OAuthProtectedResourceMetadata | null,
): URL[] {
  const primary = getAuthorizationServerUrl(serverUrl, resourceMetadata);
  const namedByMetadata = Boolean(resourceMetadata?.authorization_servers?.[0]);
  if (namedByMetadata || primary.pathname === "/") return [primary];
  return [primary, new URL("/", primary)];
}

export interface DiscoveredAuthorizationServer {
  /** The candidate that answered — not necessarily the first one tried. */
  authorizationServerUrl: URL;
  metadata: NonNullable<AuthorizationServerMetadata>;
}

/**
 * Walks `candidates` until one answers, and reports **which** one did.
 *
 * A candidate that fails — a 5xx, or an RFC 8414 §3.3 issuer mismatch, both of
 * which the SDK raises rather than returning `undefined` — is not fatal while
 * another candidate remains. If every candidate fails, the first error is
 * rethrown, so a caller still sees the original diagnosis rather than a bare
 * `undefined`.
 *
 * `discover` is injected rather than closed over so a caller that already owns
 * a discovery function — the CLI's `refreshStoredAuthToken`, which takes one as
 * a test seam — can walk the same candidates without giving that seam up.
 */
export async function discoverAuthorizationServerMetadataFromCandidates(
  candidates: URL[],
  discover: (url: URL) => Promise<AuthorizationServerMetadata>,
): Promise<DiscoveredAuthorizationServer | undefined> {
  let firstError: unknown;
  let sawError = false;
  for (const candidate of candidates) {
    try {
      const metadata = await discover(candidate);
      if (metadata) return { authorizationServerUrl: candidate, metadata };
    } catch (err) {
      if (!sawError) {
        firstError = err;
        sawError = true;
      }
    }
  }
  if (sawError) throw firstError;
  return undefined;
}

/**
 * Discovers authorization server metadata for an MCP server, walking the
 * candidates above until one answers.
 */
export async function discoverAuthorizationServerMetadataForServer(
  serverUrl: string,
  resourceMetadata?: OAuthProtectedResourceMetadata | null,
  fetchFn?: typeof fetch,
): Promise<AuthorizationServerMetadata> {
  const found = await discoverAuthorizationServerMetadataFromCandidates(
    getAuthorizationServerUrlCandidates(serverUrl, resourceMetadata),
    (candidate) => discoverAuthorizationServerMetadata(candidate, { fetchFn }),
  );
  return found?.metadata;
}

/**
 * Discovers OAuth scopes from server metadata, with preference for resource metadata scopes
 * @param serverUrl - The MCP server URL
 * @param resourceMetadata - Optional resource metadata containing preferred scopes
 * @param fetchFn - Optional fetch function for HTTP requests (e.g. proxy fetch in browser)
 * @returns Promise resolving to space-separated scope string or undefined
 */
export const discoverScopes = async (
  serverUrl: string,
  resourceMetadata?: OAuthProtectedResourceMetadata,
  fetchFn?: typeof fetch,
): Promise<string | undefined> => {
  try {
    const metadata = await discoverAuthorizationServerMetadataForServer(
      serverUrl,
      resourceMetadata,
      fetchFn,
    );

    // Prefer resource metadata scopes, but fall back to OAuth metadata if empty
    const resourceScopes = resourceMetadata?.scopes_supported;
    const oauthScopes = metadata?.scopes_supported;

    const scopesSupported =
      resourceScopes && resourceScopes.length > 0
        ? resourceScopes
        : oauthScopes;

    return scopesSupported && scopesSupported.length > 0
      ? scopesSupported.join(" ")
      : undefined;
  } catch {
    return undefined;
  }
};
