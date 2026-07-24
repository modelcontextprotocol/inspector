import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  selectResourceURL,
} from "@modelcontextprotocol/client";
import type { OAuthClientProvider } from "@modelcontextprotocol/client";
import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/client";
import { getAuthorizationServerUrl } from "../discovery.js";

export interface EmaResourceContext {
  resourceMetadata: OAuthProtectedResourceMetadata;
  resourceAsUrl: URL;
  resourceUrl?: URL;
  scope?: string;
}

export function resolveEmaScopes(
  resourceMetadata: OAuthProtectedResourceMetadata | null | undefined,
  configuredScope?: string,
): string | undefined {
  const trimmed = configuredScope?.trim();
  if (trimmed) return trimmed;
  const supported = resourceMetadata?.scopes_supported;
  if (supported && supported.length > 0) {
    return supported.join(" ");
  }
  return undefined;
}

export async function discoverEmaResourceContext(
  serverUrl: string,
  configuredScope?: string,
  fetchFn?: typeof fetch,
): Promise<EmaResourceContext> {
  const resourceMetadata = await discoverOAuthProtectedResourceMetadata(
    serverUrl,
    undefined,
    fetchFn,
  );
  /* v8 ignore start -- defensive: the SDK's discoverOAuthProtectedResourceMetadata
     validates the response against a Zod schema that requires `resource` to be a
     valid URL, so a metadata object reaching here always has a truthy `resource`.
     This guard is unreachable through the public discovery path. */
  if (!resourceMetadata.resource) {
    throw new Error(
      "EMA requires protected resource metadata with a resource identifier",
    );
  }
  /* v8 ignore stop */
  const resourceAsUrl = getAuthorizationServerUrl(serverUrl, resourceMetadata);
  const resourceUrl = await selectResourceURL(
    serverUrl,
    // `selectResourceURL` only reads `clientMetadata.scope` off the provider, so
    // we pass a minimal stub carrying just that. A partial literal has too little
    // overlap with the full `OAuthClientProvider` interface for a single cast, so
    // the double cast bridges the deliberately-incomplete shape here.
    {
      clientMetadata: {
        scope: configuredScope ?? "",
        redirect_uris: [],
      },
    } as unknown as OAuthClientProvider,
    resourceMetadata,
  );
  const scope = resolveEmaScopes(resourceMetadata, configuredScope);
  return {
    resourceMetadata,
    resourceAsUrl,
    resourceUrl: resourceUrl ?? undefined,
    scope,
  };
}

export async function discoverResourceAsMetadata(
  resourceAsUrl: URL,
  fetchFn?: typeof fetch,
) {
  const metadata = await discoverAuthorizationServerMetadata(resourceAsUrl, {
    fetchFn,
  });
  if (!metadata) {
    throw new Error(
      "Failed to discover resource authorization server metadata",
    );
  }
  return metadata;
}
