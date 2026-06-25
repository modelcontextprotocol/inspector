import { selectClientAuthMethod } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export async function parseOAuthTokenErrorResponse(
  response: Response,
  step: string,
): Promise<Error> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new Error(`${step}: token request failed (HTTP ${response.status})`);
  }
  if (typeof body === "object" && body !== null) {
    const record = body as { error?: string; error_description?: string };
    const parts = [step];
    if (record.error) parts.push(`error=${record.error}`);
    if (record.error_description) parts.push(record.error_description);
    if (parts.length > 1) {
      return new Error(parts.join(": "));
    }
  }
  return new Error(`${step}: token request failed (HTTP ${response.status})`);
}

function applyClientAuth(
  metadata: OAuthMetadata | undefined,
  clientInformation: OAuthClientInformation,
  headers: Headers,
  body: URLSearchParams,
): void {
  const supported = metadata?.token_endpoint_auth_methods_supported ?? [];
  const method = selectClientAuthMethod(clientInformation, supported);
  if (method === "client_secret_basic" && clientInformation.client_secret) {
    const credentials = btoa(
      `${clientInformation.client_id}:${clientInformation.client_secret}`,
    );
    headers.set("Authorization", `Basic ${credentials}`);
    return;
  }
  if (method === "client_secret_post" && clientInformation.client_secret) {
    body.set("client_id", clientInformation.client_id);
    body.set("client_secret", clientInformation.client_secret);
    return;
  }
  body.set("client_id", clientInformation.client_id);
}

/** POST application/x-www-form-urlencoded to an OAuth token endpoint. */
export async function postOAuthTokenRequest(
  tokenUrl: URL,
  body: URLSearchParams,
  metadata: OAuthMetadata | undefined,
  clientInformation: OAuthClientInformation,
  fetchFn?: typeof fetch,
): Promise<Response> {
  const headers = new Headers({
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  });
  applyClientAuth(metadata, clientInformation, headers, body);
  return (fetchFn ?? fetch)(tokenUrl, {
    method: "POST",
    headers,
    body,
  });
}
