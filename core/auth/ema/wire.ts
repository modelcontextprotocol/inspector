import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
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
import { normalizeIdpIssuer } from "./storage.js";
import {
  parseOAuthTokenErrorResponse,
  postOAuthTokenRequest,
} from "./tokenEndpoint.js";

/** Leg 2 — exchange ID Token for ID-JAG at the enterprise IdP (RFC 8693). */
export async function exchangeIdJag(params: {
  idp: EnterpriseManagedAuthIdpConfig;
  idToken: string;
  audience: string;
  resource?: string;
  scope?: string;
  fetchFn?: typeof fetch;
}): Promise<string> {
  const issuer = normalizeIdpIssuer(params.idp.issuer);
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

  const response = await postOAuthTokenRequest(
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
    throw await parseOAuthTokenErrorResponse(
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

  const response = await postOAuthTokenRequest(
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
    throw await parseOAuthTokenErrorResponse(
      response,
      "EMA leg 3 (resource AS JWT bearer grant)",
    );
  }

  return OAuthTokensSchema.parse(await response.json());
}
