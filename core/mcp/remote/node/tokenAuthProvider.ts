import type { OAuthClientProvider } from "@modelcontextprotocol/client";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/client";
import type { RemoteAuthState } from "../types.js";

const REMOTE_OAUTH_STUB_METADATA: OAuthClientMetadata = {
  redirect_uris: [],
  scope: "",
};

export interface RemoteAuthProviderHandle {
  provider: OAuthClientProvider;
  setAuthState: (authState: RemoteAuthState) => void;
  getAuthState: () => RemoteAuthState;
}

function cloneAuthState(state: RemoteAuthState): RemoteAuthState {
  return {
    ...(state.oauthTokens && {
      oauthTokens: { ...state.oauthTokens },
    }),
    ...(state.oauthClient && {
      oauthClient: { ...state.oauthClient },
    }),
  };
}

/**
 * Mutable OAuth provider for the remote backend MCP transport.
 * Browser (or CLI) owns interactive OAuth; this injects Bearer tokens and can
 * be hot-updated via {@link RemoteAuthProviderHandle.setAuthState}.
 */
export function createRemoteAuthProvider(
  initialAuthState?: RemoteAuthState,
): RemoteAuthProviderHandle | undefined {
  if (!initialAuthState?.oauthTokens && !initialAuthState?.oauthClient) {
    return undefined;
  }

  let authState = cloneAuthState(initialAuthState);

  const provider = {
    get clientMetadata(): OAuthClientMetadata {
      return REMOTE_OAUTH_STUB_METADATA;
    },
    get redirectUrl(): string {
      return "";
    },
    async tokens(): Promise<OAuthTokens | undefined> {
      return authState.oauthTokens as OAuthTokens | undefined;
    },
    async clientInformation(): Promise<OAuthClientInformation | undefined> {
      if (!authState.oauthClient?.client_id) {
        return undefined;
      }
      return {
        client_id: authState.oauthClient.client_id,
        ...(authState.oauthClient.client_secret && {
          client_secret: authState.oauthClient.client_secret,
        }),
      };
    },
    async saveTokens(tokens: OAuthTokens) {
      authState = {
        ...authState,
        oauthTokens: {
          access_token: tokens.access_token,
          token_type: tokens.token_type,
          expires_in: tokens.expires_in,
          refresh_token: tokens.refresh_token,
          scope: tokens.scope,
          id_token: tokens.id_token,
        },
      };
    },
    codeVerifier() {
      return undefined;
    },
    async saveCodeVerifier() {
      // No-op
    },
    clear() {
      authState = {};
    },
    async redirectToAuthorization() {
      throw new Error(
        "OAuth re-authorization must be performed in the Inspector web client (remote server cannot complete OAuth flows)",
      );
    },
    state() {
      return "";
    },
    // This provider implements only the members the remote backend transport
    // exercises (token get/save, client info, non-interactive redirect); the
    // interactive-only members the SDK never calls on the server side are stubbed
    // with narrower shapes (e.g. `codeVerifier()` returns `undefined`, not the
    // interface's `string | Promise<string>`), so it can't be assigned to the
    // full `OAuthClientProvider` without the double cast.
  } as unknown as OAuthClientProvider;

  return {
    provider,
    setAuthState(next: RemoteAuthState) {
      authState = cloneAuthState(next);
    },
    getAuthState() {
      return cloneAuthState(authState);
    },
  };
}
