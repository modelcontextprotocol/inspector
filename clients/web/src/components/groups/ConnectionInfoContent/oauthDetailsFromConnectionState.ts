import type { OAuthConnectionState } from "@inspector/core/auth/types.js";
import type { OAuthDetails } from "./ConnectionInfoContent";

/** Map persisted connection auth state into Connection Info display props. */
export function oauthDetailsFromConnectionState(
  state: OAuthConnectionState,
): OAuthDetails {
  const scopeSource = state.grantedScope ?? state.configuredScope;
  const scopes = scopeSource?.split(" ").filter(Boolean);

  return {
    protocol: state.protocol,
    authorized: state.authorized,
    ...(state.client?.clientId && { clientId: state.client.clientId }),
    ...(state.authorizationServerMetadata?.authorization_endpoint && {
      authUrl: state.authorizationServerMetadata.authorization_endpoint,
    }),
    ...(scopes && scopes.length > 0 && { scopes }),
    ...(state.tokens?.access_token && {
      accessToken: state.tokens.access_token,
    }),
    ...(state.protocol === "ema" &&
      state.ema?.idpSession && { idpSession: state.ema.idpSession }),
  };
}
