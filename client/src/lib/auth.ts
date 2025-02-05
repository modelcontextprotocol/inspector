import pkceChallenge from "pkce-challenge";
import { SESSION_KEYS } from "./constants";
import { z } from "zod";

export const OAuthMetadataSchema = z.object({
  authorization_endpoint: z.string(),
  token_endpoint: z.string()
});

export type OAuthMetadata = z.infer<typeof OAuthMetadataSchema>;

export const OAuthTokensSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional()
});

export type OAuthTokens = z.infer<typeof OAuthTokensSchema>;

export async function discoverOAuthMetadata(
  serverUrl: string,
): Promise<OAuthMetadata> {
  try {
    const url = new URL("/.well-known/oauth-authorization-server", serverUrl);
    const response = await fetch(url.toString());

    if (response.ok) {
      const metadata = await response.json();
      const validatedMetadata = OAuthMetadataSchema.parse({
        authorization_endpoint: metadata.authorization_endpoint,
        token_endpoint: metadata.token_endpoint,
      });
      return validatedMetadata;
    }
  } catch (error) {
    console.warn("OAuth metadata discovery failed:", error);
  }

  // Fall back to default endpoints
  const baseUrl = new URL(serverUrl);
  const defaultMetadata = {
    authorization_endpoint: new URL("/authorize", baseUrl).toString(),
    token_endpoint: new URL("/token", baseUrl).toString(),
  };
  return OAuthMetadataSchema.parse(defaultMetadata);
}

export async function startOAuthFlow(serverUrl: string): Promise<string> {
  // Generate PKCE challenge
  const challenge = await pkceChallenge();
  const codeVerifier = challenge.code_verifier;
  const codeChallenge = challenge.code_challenge;

  // Store code verifier for later use
  sessionStorage.setItem(SESSION_KEYS.CODE_VERIFIER, codeVerifier);

  // Discover OAuth endpoints
  const metadata = await discoverOAuthMetadata(serverUrl);

  // Build authorization URL
  const authUrl = new URL(metadata.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set(
    "redirect_uri",
    window.location.origin + "/oauth/callback",
  );

  return authUrl.toString();
}

export async function handleOAuthCallback(
  serverUrl: string,
  code: string,
): Promise<OAuthTokens> {
  // Get stored code verifier
  const codeVerifier = sessionStorage.getItem(SESSION_KEYS.CODE_VERIFIER);
  if (!codeVerifier) {
    throw new Error("No code verifier found");
  }

  // Discover OAuth endpoints
  const metadata = await discoverOAuthMetadata(serverUrl);
  // Exchange code for tokens
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: window.location.origin + "/oauth/callback",
    }),
  });

  if (!response.ok) {
    throw new Error("Token exchange failed");
  }

  const tokens = await response.json();
  return OAuthTokensSchema.parse(tokens);
}

export async function refreshAccessToken(
  serverUrl: string,
): Promise<OAuthTokens> {
  const refreshToken = sessionStorage.getItem(SESSION_KEYS.REFRESH_TOKEN);
  if (!refreshToken) {
    throw new Error("No refresh token available");
  }

  const metadata = await discoverOAuthMetadata(serverUrl);

  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error("Token refresh failed");
  }

  const tokens = await response.json();
  return OAuthTokensSchema.parse(tokens);
}
