/**
 * v2-shaped OAuth orchestrator for standard MCP resource authorization.
 *
 * **Upgrade path:** On `@modelcontextprotocol/client` v2, replace this module
 * with `export { auth as mcpAuth, type AuthOptions as McpAuthOptions } from
 * "@modelcontextprotocol/client"` and delete `authorizeWithoutRefresh`.
 *
 * Until then, `mcpAuth` delegates to SDK v1 `auth()` except when
 * `forceReauthorization: true` — then it runs discovery + `startAuthorization`
 * (the same path v2 `auth()` takes when refresh cannot widen scope).
 */

import {
  auth as sdkAuth,
  discoverOAuthServerInfo,
  isHttpsUrl,
  registerClient,
  selectResourceURL,
  startAuthorization,
} from "@modelcontextprotocol/client";
import type { OAuthClientProvider } from "@modelcontextprotocol/client";
import type { FetchLike } from "@modelcontextprotocol/client";
/**
 * Thrown when the OAuth client metadata the Inspector would register is
 * invalid (e.g. a non-HTTPS `clientMetadataUrl`). SDK v2 moved the original
 * `InvalidClientMetadataError` into `@modelcontextprotocol/server-legacy`,
 * whose `/auth` entry pulls in Node/Express server handlers that must never
 * reach the browser bundle. This local class preserves the thrown type and
 * message for the Inspector's client-side validation without that dependency.
 */
export class InvalidClientMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidClientMetadataError";
  }
}

export type McpAuthResult = "AUTHORIZED" | "REDIRECT";

/**
 * Options aligned with v2 SDK `AuthOptions`. v2-only fields are accepted now
 * and forwarded on upgrade; v1 passthrough ignores unsupported fields.
 */
export interface McpAuthOptions {
  serverUrl: string | URL;
  authorizationCode?: string;
  /** RFC 9207 callback `iss` — forwarded on v2 upgrade; ignored by v1 SDK `auth()`. */
  iss?: string;
  scope?: string;
  resourceMetadataUrl?: URL;
  fetchFn?: FetchLike;
  /** v2 SEP-2468 — ignored until SDK v2 upgrade. */
  skipIssuerMetadataValidation?: boolean;
  /**
   * Skip refresh and start an authorization-code flow. Required for step-up
   * when the union scope exceeds the current token grant (RFC 6749 §6).
   */
  forceReauthorization?: boolean;
}

export async function mcpAuth(
  provider: OAuthClientProvider,
  options: McpAuthOptions,
): Promise<McpAuthResult> {
  if (options.forceReauthorization) {
    if (options.authorizationCode !== undefined) {
      throw new Error(
        "forceReauthorization cannot be combined with authorizationCode",
      );
    }
    return authorizeWithoutRefresh(provider, options);
  }

  return sdkAuth(provider, {
    serverUrl: options.serverUrl,
    authorizationCode: options.authorizationCode,
    scope: options.scope,
    resourceMetadataUrl: options.resourceMetadataUrl,
    fetchFn: options.fetchFn,
  });
}

async function authorizeWithoutRefresh(
  provider: OAuthClientProvider,
  options: McpAuthOptions,
): Promise<"REDIRECT"> {
  const { serverUrl, scope, resourceMetadataUrl, fetchFn } = options;

  const serverInfo = await discoverOAuthServerInfo(serverUrl, {
    resourceMetadataUrl,
    fetchFn,
  });
  const {
    authorizationServerUrl,
    authorizationServerMetadata: metadata,
    resourceMetadata,
  } = serverInfo;

  await provider.saveDiscoveryState?.({
    authorizationServerUrl: String(authorizationServerUrl),
    resourceMetadataUrl: resourceMetadataUrl?.toString(),
    resourceMetadata,
    authorizationServerMetadata: metadata,
  });

  const resource = await selectResourceURL(
    serverUrl,
    provider,
    resourceMetadata,
  );

  const resolvedScope =
    scope ||
    resourceMetadata?.scopes_supported?.join(" ") ||
    provider.clientMetadata.scope;

  let clientInformation = await Promise.resolve(provider.clientInformation());
  if (!clientInformation) {
    const supportsUrlBasedClientId =
      metadata?.client_id_metadata_document_supported === true;
    const clientMetadataUrl = provider.clientMetadataUrl;
    if (clientMetadataUrl && !isHttpsUrl(clientMetadataUrl)) {
      throw new InvalidClientMetadataError(
        `clientMetadataUrl must be a valid HTTPS URL with a non-root pathname, got: ${clientMetadataUrl}`,
      );
    }
    const shouldUseUrlBasedClientId =
      supportsUrlBasedClientId && clientMetadataUrl;
    if (shouldUseUrlBasedClientId) {
      clientInformation = { client_id: clientMetadataUrl };
      await provider.saveClientInformation?.(clientInformation);
    } else {
      if (!provider.saveClientInformation) {
        throw new Error(
          "OAuth client information must be saveable for dynamic registration",
        );
      }
      const fullInformation = await registerClient(authorizationServerUrl, {
        metadata,
        clientMetadata: provider.clientMetadata,
        scope: resolvedScope,
        fetchFn,
      });
      await provider.saveClientInformation(fullInformation);
      clientInformation = fullInformation;
    }
  }

  const state = provider.state ? await provider.state() : undefined;
  const redirectUrl = provider.redirectUrl;
  if (!redirectUrl) {
    throw new Error("redirectUrl is required for authorization_code flow");
  }
  const { authorizationUrl, codeVerifier } = await startAuthorization(
    authorizationServerUrl,
    {
      metadata,
      clientInformation,
      state,
      redirectUrl,
      scope: resolvedScope,
      resource,
    },
  );

  await provider.saveCodeVerifier(codeVerifier);
  await provider.redirectToAuthorization(authorizationUrl);
  return "REDIRECT";
}
