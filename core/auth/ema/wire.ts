import { discoverAndRequestJwtAuthGrant } from "@modelcontextprotocol/client";
import type {
  OAuthClientInformation,
  OAuthTokens,
} from "@modelcontextprotocol/client";
import { OAuthTokensSchema } from "@modelcontextprotocol/core";
import type { EnterpriseManagedAuthIdpConfig } from "../../client/types.js";
import { GRANT_TYPE_JWT_BEARER } from "./constants.js";
import { parseHttpUrl } from "../utils.js";
import { discoverResourceAsMetadata } from "./resourceContext.js";
import { normalizeIdpIssuer } from "./storage.js";
import {
  parseOAuthTokenErrorResponse,
  postOAuthTokenRequest,
} from "./tokenEndpoint.js";

/**
 * Leg 2 — exchange ID Token for ID-JAG at the enterprise IdP (RFC 8693).
 *
 * Delegates to SDK `discoverAndRequestJwtAuthGrant`. `resource` is required
 * (the SDK always sends it on the wire). Callers should pass
 * `resourceUrl ?? resourceMetadata.resource` from EMA resource context discovery.
 */
export async function exchangeIdJag(params: {
  idp: EnterpriseManagedAuthIdpConfig;
  idToken: string;
  audience: string;
  /** RFC 8707 resource indicator — required by the SDK Layer-2 helper. */
  resource: string;
  scope?: string;
  fetchFn?: typeof fetch;
}): Promise<string> {
  const issuer = normalizeIdpIssuer(params.idp.issuer);
  const resource = params.resource.trim();
  if (!resource) {
    throw new Error("EMA leg 2 requires a resource identifier");
  }

  let result: Awaited<ReturnType<typeof discoverAndRequestJwtAuthGrant>>;
  try {
    result = await discoverAndRequestJwtAuthGrant({
      idpUrl: issuer,
      audience: params.audience,
      resource,
      idToken: params.idToken,
      clientId: params.idp.clientId,
      clientSecret: params.idp.clientSecret,
      scope: params.scope,
      fetchFn: params.fetchFn,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Drift-sensitive: `@modelcontextprotocol/client` currently throws plain
    // `Error`s (not typed SdkError codes) for these failure modes. Remap to
    // stable Inspector UX strings by matching SDK wording. Prefer typed errors
    // when the SDK grows them. Canaries in `wire.test.ts` call the real helper
    // so a wording change fails CI instead of silently falling through.
    if (/Failed to discover token endpoint/i.test(message)) {
      throw new Error("IdP metadata missing token_endpoint", { cause: err });
    }
    if (/Invalid token exchange response/i.test(message)) {
      throw new Error("IdP token exchange did not return an ID-JAG", {
        cause: err,
      });
    }
    throw new Error(`EMA leg 2 (IdP token exchange for ID-JAG): ${message}`, {
      cause: err,
    });
  }

  if (!result.jwtAuthGrant) {
    throw new Error("IdP token exchange did not return an ID-JAG");
  }
  return result.jwtAuthGrant;
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
