/**
 * OAuth authorization flow handlers
 */
import { randomBytes } from "node:crypto";
import pkceChallenge from "pkce-challenge";
import { AuthorizationRequest, AuthorizationResult } from "./types.js";

/**
 * Generate PKCE code verifier and challenge using the pkce-challenge package
 */
export async function generatePKCE(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const { code_verifier, code_challenge } = await pkceChallenge();
  return {
    codeVerifier: code_verifier,
    codeChallenge: code_challenge,
  };
}

/**
 * Generate a cryptographically secure state parameter
 */
export function generateState(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Create OAuth authorization URL with PKCE
 */
export async function createAuthorizationUrl(
  request: AuthorizationRequest,
): Promise<AuthorizationResult> {
  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = generateState();

  const url = new URL(request.authServerUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", request.clientId);
  url.searchParams.set("redirect_uri", request.redirectUri);
  url.searchParams.set("scope", request.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  if (request.resource) {
    url.searchParams.set("resource", request.resource);
  }

  return {
    authorizationUrl: url.toString(),
    codeVerifier,
    state,
  };
}
