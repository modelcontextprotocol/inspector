import {
  OAuthTokens,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Inputs for the OAuth 2.0 Client Credentials grant token request.
 *
 * RFC 6749 section 4.4.2 defines the request as:
 *   grant_type=client_credentials [&scope=...]
 * with the client authenticating to the token endpoint via either HTTP Basic
 * (preferred when supported) or by including client_id/client_secret in the
 * request body.
 *
 * See: https://datatracker.ietf.org/doc/html/rfc6749#section-4.4
 */
export interface ClientCredentialsRequest {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  /**
   * Optional resource indicator (RFC 8707). Some authorization servers
   * (e.g. those securing MCP servers behind an API gateway) require it.
   */
  resource?: string;
  /**
   * How the client credentials are sent to the token endpoint. Defaults to
   * "basic" (HTTP Basic Authentication, the OAuth 2.1 recommended approach).
   * Use "body" when the authorization server only accepts credentials in the
   * request body.
   */
  authMethod?: "basic" | "body";
}

/**
 * Builds the body and headers for a client_credentials token request.
 * Exposed so it can be unit-tested without performing a real fetch.
 */
export function buildClientCredentialsRequest(
  options: ClientCredentialsRequest,
): { headers: Record<string, string>; body: URLSearchParams } {
  const { clientId, clientSecret, scope, resource, authMethod } = options;
  const method = authMethod ?? "basic";

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  if (scope && scope.trim() !== "") {
    body.set("scope", scope.trim());
  }
  if (resource) {
    body.set("resource", resource);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  if (method === "basic") {
    // RFC 6749 section 2.3.1: client_id and client_secret must be
    // form-urlencoded before being concatenated and base64-encoded for HTTP
    // Basic.
    const credentials = `${encodeURIComponent(clientId)}:${encodeURIComponent(
      clientSecret,
    )}`;
    headers.Authorization = `Basic ${btoa(credentials)}`;
  } else {
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
  }

  return { headers, body };
}

/**
 * Performs an OAuth 2.0 client_credentials token exchange against the given
 * token endpoint and returns the parsed tokens. Throws on non-2xx responses
 * with a message that includes the server's error/description if present.
 */
export async function exchangeClientCredentials(
  options: ClientCredentialsRequest,
  fetchFn: typeof fetch = fetch,
): Promise<OAuthTokens> {
  const { tokenEndpoint } = options;
  const { headers, body } = buildClientCredentialsRequest(options);

  const response = await fetchFn(tokenEndpoint, {
    method: "POST",
    headers,
    body,
  });

  // Read body as text first so we can surface the OAuth error payload even
  // when the server returns a non-JSON response.
  const text = await response.text();

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`.trim();
    try {
      const parsed = JSON.parse(text) as {
        error?: string;
        error_description?: string;
      };
      if (parsed.error) {
        detail = parsed.error_description
          ? `${parsed.error}: ${parsed.error_description}`
          : parsed.error;
      }
    } catch {
      // Non-JSON error body — fall back to status line, append text if short.
      if (text && text.length < 500) {
        detail = `${detail} - ${text}`;
      }
    }
    throw new Error(`client_credentials token request failed: ${detail}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      "client_credentials token request returned a non-JSON response",
    );
  }

  return await OAuthTokensSchema.parseAsync(json);
}
