/**
 * OAuth client registration handlers
 * Uses the MCP SDK for Dynamic Client Registration with schema validation
 */
import { registerClient as sdkRegisterClient } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  RegisterClientRequest,
  ClientInfo,
  OAuthClientMetadata,
} from "./types.js";

/**
 * Register a client with the OAuth authorization server
 * Supports both Dynamic Client Registration (RFC 7591) and pre-registered clients
 *
 * The SDK's registerClient provides:
 * - Proper schema validation with Zod
 * - Correct OAuth error handling
 * - Full response parsing including metadata
 */
export async function registerClient(
  request: RegisterClientRequest,
): Promise<ClientInfo> {
  // If client credentials are provided, use them (pre-registered client)
  if (request.clientId) {
    return {
      clientId: request.clientId,
      clientSecret: request.clientSecret,
      isDynamic: false,
    };
  }

  // Otherwise, attempt Dynamic Client Registration using the SDK
  if (!request.metadata.registration_endpoint) {
    throw new Error(
      "No registration endpoint available and no client credentials provided",
    );
  }

  try {
    // Use the SDK's registerClient function
    const clientInfo = await sdkRegisterClient(request.authServerUrl, {
      metadata: request.metadata,
      clientMetadata: request.clientMetadata || buildClientMetadata(""),
    });

    return {
      clientId: clientInfo.client_id,
      clientSecret: clientInfo.client_secret,
      isDynamic: true,
    };
  } catch (error) {
    console.error("Error during client registration:", error);
    throw error;
  }
}

/**
 * Helper to build default client metadata
 */
export function buildClientMetadata(
  redirectUri: string,
  scope?: string,
): OAuthClientMetadata {
  return {
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    scope: scope || "",
    client_name: "MCP Inspector",
  };
}
