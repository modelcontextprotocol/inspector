/**
 * OAuth token refresh handlers
 * Uses the MCP SDK for token refresh with proper client authentication
 */
import { refreshAuthorization as sdkRefreshAuthorization } from "@modelcontextprotocol/sdk/client/auth.js";
import type { TokenRefreshRequest, OAuthTokens } from "./types.js";
import { OAuthTokensSchema } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Refresh access token using refresh token
 *
 * The SDK's refreshAuthorization automatically:
 * - Selects the best client authentication method
 * - Preserves the original refresh token if a new one is not returned
 * - Validates the response with Zod schemas
 *
 * Note: Like exchangeToken, we extract the auth server URL from the token endpoint
 */
export async function refreshToken(
  request: TokenRefreshRequest,
): Promise<OAuthTokens> {
  try {
    // Extract the authorization server base URL from the token endpoint
    const tokenUrl = new URL(request.tokenEndpoint);
    const authServerUrl = `${tokenUrl.protocol}//${tokenUrl.host}`;

    // Use the SDK's refreshAuthorization function
    const tokens = await sdkRefreshAuthorization(authServerUrl, {
      clientInformation: {
        client_id: request.clientId,
        client_secret: request.clientSecret,
      },
      refreshToken: request.refreshToken,
    });

    // Validate the response with Zod schema
    return OAuthTokensSchema.parse(tokens);
  } catch (error) {
    console.error("Error during token refresh:", error);
    throw error;
  }
}
