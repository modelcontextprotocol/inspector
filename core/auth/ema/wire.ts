import {
  discoverAuthorizationServerMetadata,
  selectClientAuthMethod,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { OAuthTokensSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { EnterpriseManagedAuthIdpConfig } from "../../client/types.js";
import {
  GRANT_TYPE_JWT_BEARER,
  GRANT_TYPE_TOKEN_EXCHANGE,
  TOKEN_TYPE_ID_JAG,
  TOKEN_TYPE_ID_TOKEN,
} from "./constants.js";
import { parseHttpUrl } from "../utils.js";
import { discoverResourceAsMetadata } from "./resourceContext.js";

async function parseOAuthErrorResponse(
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

async function postTokenRequest(
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

/** Leg 2 — exchange ID Token for ID-JAG at the enterprise IdP (RFC 8693). */
export async function exchangeIdJag(params: {
  idp: EnterpriseManagedAuthIdpConfig;
  idToken: string;
  audience: string;
  resource?: string;
  scope?: string;
  fetchFn?: typeof fetch;
}): Promise<string> {
  const issuer = params.idp.issuer.replace(/\/$/, "");
  const issuerUrl = parseHttpUrl(issuer, "EMA IdP issuer (Client Settings)");
  const idpMetadata = await discoverAuthorizationServerMetadata(issuerUrl, {
    fetchFn: params.fetchFn,
  });
  if (!idpMetadata?.token_endpoint) {
    throw new Error("IdP metadata missing token_endpoint");
  }

  const clientInformation = {
    client_id: params.idp.clientId,
    client_secret: params.idp.clientSecret,
    token_endpoint_auth_method: "client_secret_post",
  } as OAuthClientInformation;

  const body = new URLSearchParams({
    grant_type: GRANT_TYPE_TOKEN_EXCHANGE,
    requested_token_type: TOKEN_TYPE_ID_JAG,
    subject_token: params.idToken,
    subject_token_type: TOKEN_TYPE_ID_TOKEN,
    audience: params.audience,
  });
  if (params.resource) {
    body.set("resource", params.resource);
  }
  if (params.scope) {
    body.set("scope", params.scope);
  }

  const response = await postTokenRequest(
    parseHttpUrl(
      idpMetadata.token_endpoint,
      "IdP token_endpoint (from OIDC discovery)",
    ),
    body,
    idpMetadata,
    clientInformation,
    params.fetchFn,
  );
  if (!response.ok) {
    throw await parseOAuthErrorResponse(
      response,
      "EMA leg 2 (IdP token exchange for ID-JAG)",
    );
  }

  const json = (await response.json()) as {
    access_token?: string;
    issued_token_type?: string;
  };
  const idJag = json.access_token;
  if (!idJag) {
    throw new Error("IdP token exchange did not return an ID-JAG");
  }
  return idJag;
}

/** Leg 3 — redeem ID-JAG for MCP resource access token (RFC 7523). */
export async function redeemIdJagForAccessToken(params: {
  resourceAsUrl: URL;
  idJag: string;
  resourceClientId: string;
  resourceClientSecret?: string;
  resource?: string;
  scope?: string;
  fetchFn?: typeof fetch;
}): Promise<OAuthTokens> {
  const asMetadata = await discoverResourceAsMetadata(
    params.resourceAsUrl,
    params.fetchFn,
  );
  if (!asMetadata.token_endpoint) {
    throw new Error("Resource AS metadata missing token_endpoint");
  }

  const clientInformation = {
    client_id: params.resourceClientId,
    ...(params.resourceClientSecret && {
      client_secret: params.resourceClientSecret,
    }),
    token_endpoint_auth_method: params.resourceClientSecret
      ? "client_secret_post"
      : "none",
  } as OAuthClientInformation;

  const body = new URLSearchParams({
    grant_type: GRANT_TYPE_JWT_BEARER,
    assertion: params.idJag,
  });
  if (params.scope) {
    body.set("scope", params.scope);
  }
  if (params.resource) {
    body.set("resource", params.resource);
  }

  const response = await postTokenRequest(
    parseHttpUrl(
      asMetadata.token_endpoint,
      "resource authorization server token_endpoint (from AS discovery)",
    ),
    body,
    asMetadata,
    clientInformation,
    params.fetchFn,
  );
  if (!response.ok) {
    throw await parseOAuthErrorResponse(
      response,
      "EMA leg 3 (resource AS JWT bearer grant)",
    );
  }

  return OAuthTokensSchema.parse(await response.json());
}
