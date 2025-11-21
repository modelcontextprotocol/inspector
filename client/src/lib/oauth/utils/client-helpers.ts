/**
 * Helper utilities for working with OAuth client information
 */
import {
  OAuthClientInformation,
  OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Safely extracts client secret from client information if available.
 * Returns undefined if the client information doesn't have a client_secret.
 *
 * @param clientInfo - OAuth client information (may or may not have client_secret)
 * @returns The client secret if available, undefined otherwise
 */
export function extractClientSecret(
  clientInfo: OAuthClientInformation | OAuthClientInformationFull,
): string | undefined {
  return "client_secret" in clientInfo ? clientInfo.client_secret : undefined;
}
