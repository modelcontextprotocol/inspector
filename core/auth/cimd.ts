import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformation } from "@modelcontextprotocol/sdk/shared/auth.js";
import { getAuthorizationServerUrl } from "./discovery.js";
import type { BaseOAuthClientProvider } from "./providers.js";

/**
 * When the authorization server supports URL-based client IDs (SEP-991 / CIMD),
 * pre-register `{ client_id: clientMetadataUrl }` before SDK `auth()`.
 *
 * SDK `auth()` rejects non-HTTPS `clientMetadataUrl` during registration, but
 * accepts an already-stored `client_id` (including `http://` URLs used by local
 * dev/test metadata servers). Production CIMD metadata documents should still
 * use HTTPS per SEP-991.
 */
export async function ensureCimdClientRegistration(params: {
  serverUrl: string;
  provider: BaseOAuthClientProvider;
  fetchFn?: typeof fetch;
}): Promise<void> {
  const clientMetadataUrl = params.provider.clientMetadataUrl?.trim();
  if (!clientMetadataUrl) return;

  const existing = await params.provider.clientInformation();
  if (existing?.client_id) return;

  let resourceMetadata;
  try {
    resourceMetadata = await discoverOAuthProtectedResourceMetadata(
      params.serverUrl,
    );
  } catch {
    resourceMetadata = undefined;
  }

  const authServerUrl = getAuthorizationServerUrl(
    params.serverUrl,
    resourceMetadata,
  );

  const metadata = await discoverAuthorizationServerMetadata(authServerUrl, {
    ...(params.fetchFn && { fetchFn: params.fetchFn }),
  });
  if (!metadata?.client_id_metadata_document_supported) return;

  const clientInformation: OAuthClientInformation = {
    client_id: clientMetadataUrl,
  };
  await params.provider.saveClientInformation(clientInformation);
}
