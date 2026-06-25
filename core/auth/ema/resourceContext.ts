import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  selectResourceURL,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
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
  if (!resourceMetadata.resource) {
    throw new Error(
      "EMA requires protected resource metadata with a resource identifier",
    );
  }
  const resourceAsUrl = getAuthorizationServerUrl(serverUrl, resourceMetadata);
  const resourceUrl = await selectResourceURL(
    serverUrl,
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
    throw new Error("Failed to discover resource authorization server metadata");
  }
  return metadata;
}
