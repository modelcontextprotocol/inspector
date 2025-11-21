/**
 * OAuth token exchange handlers
 */
import type { TokenExchangeRequest, OAuthTokens } from "./types.js";

/**
 * Exchange authorization code for access token
 * Handles PKCE verification
 */
export async function exchangeToken(
  request: TokenExchangeRequest,
): Promise<OAuthTokens> {
  const params = new URLSearchParams();
  params.set("grant_type", "authorization_code");
  params.set("code", request.code);
  params.set("redirect_uri", request.redirectUri);
  params.set("client_id", request.clientId);
  params.set("code_verifier", request.codeVerifier);

  if (request.clientSecret) {
    params.set("client_secret", request.clientSecret);
  }

  if (request.resource) {
    params.set("resource", request.resource);
  }

  try {
    const response = await fetch(request.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Token exchange failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const tokens = (await response.json()) as OAuthTokens;
    return tokens;
  } catch (error) {
    console.error("Error during token exchange:", error);
    throw error;
  }
}
