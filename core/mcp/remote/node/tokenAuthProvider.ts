import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { RemoteConnectRequest } from "../types.js";

/**
 * Simple OAuth client provider that just returns tokens.
 * Used by the remote server to inject Bearer tokens into transport requests.
 * The other OAuthClientProvider methods are required by the interface but never
 * exercised in the remote-server path (the SDK only calls `tokens()` for Bearer
 * injection); they are kept as no-op stubs.
 */
export function createTokenAuthProvider(
  tokens: RemoteConnectRequest["oauthTokens"],
): OAuthClientProvider | undefined {
  if (!tokens) return undefined;

  return {
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
    redirectToAuthorization() {
      // No-op
    },
    state() {
      return "";
    },
  } as unknown as OAuthClientProvider;
}
