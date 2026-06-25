import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { RemoteConnectRequest } from "../types.js";

const REMOTE_OAUTH_STUB_METADATA: OAuthClientMetadata = {
  redirect_uris: [],
  scope: "",
};

/**
 * Simple OAuth client provider that just returns tokens.
 * Used by the remote server to inject Bearer tokens into transport requests.
 *
 * The SDK may invoke {@link auth} on 401; stubs must satisfy the full provider
 * surface so that path fails with a clear error instead of throwing on
 * undefined `clientMetadata.scope`.
 */
export function createTokenAuthProvider(
  tokens: RemoteConnectRequest["oauthTokens"],
): OAuthClientProvider | undefined {
  if (!tokens) return undefined;

  return {
    get clientMetadata(): OAuthClientMetadata {
      return REMOTE_OAUTH_STUB_METADATA;
    },
    get redirectUrl(): string {
      return "";
    },
    async tokens(): Promise<OAuthTokens | undefined> {
      return tokens as OAuthTokens;
    },
    async clientInformation() {
      return undefined;
    },
    async saveTokens() {
      // No-op
    },
    codeVerifier() {
      return undefined;
    },
    async saveCodeVerifier() {
      // No-op
    },
    clear() {
      // No-op
    },
    async redirectToAuthorization() {
      throw new Error(
        "OAuth re-authorization must be performed in the Inspector web client (remote server cannot complete OAuth flows)",
      );
    },
    state() {
      return "";
    },
  } as unknown as OAuthClientProvider;
}
