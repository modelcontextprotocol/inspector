import {
  discoverAuthorizationServerMetadata,
  exchangeAuthorization,
  startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { OAuthMetadataSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthStorage } from "../storage.js";
import type { EnterpriseManagedAuthIdpConfig } from "../../client/types.js";
import { generateOAuthState, parseHttpUrl } from "../utils.js";
import { IDP_OIDC_SCOPES } from "./constants.js";
import { isJwtExpired, jwtExpiresAtMs } from "./jwt.js";
import { idpOAuthStorageKey, normalizeIdpIssuer } from "./storage.js";
import {
  parseOAuthTokenErrorResponse,
  postOAuthTokenRequest,
} from "./tokenEndpoint.js";

function idpClientInformation(
  idp: EnterpriseManagedAuthIdpConfig,
): OAuthClientInformation {
  return {
    client_id: idp.clientId,
    client_secret: idp.clientSecret,
    token_endpoint_auth_method: "client_secret_post",
  } as OAuthClientInformation;
}

async function resolveIdpMetadata(
  issuer: string,
  storage: OAuthStorage,
  fetchFn?: typeof fetch,
): Promise<OAuthMetadata> {
  const storageKey = idpOAuthStorageKey(issuer);
  const cached = storage.getServerMetadata(storageKey);
  if (cached?.token_endpoint) {
    return cached;
  }
  return discoverIdpMetadata(issuer, fetchFn);
}

export async function discoverIdpMetadata(
  issuer: string,
  fetchFn?: typeof fetch,
): Promise<OAuthMetadata> {
  const issuerUrl = parseHttpUrl(issuer, "EMA IdP issuer (Client Settings)");
  const metadata = await discoverAuthorizationServerMetadata(issuerUrl, {
    fetchFn,
  });
  if (!metadata) {
    throw new Error(`Failed to discover OIDC metadata for IdP issuer ${issuer}`);
  }
  return OAuthMetadataSchema.parse(metadata);
}

export async function startIdpOidcAuthorization(params: {
  idp: EnterpriseManagedAuthIdpConfig;
  redirectUrl: string;
  storage: OAuthStorage;
  fetchFn?: typeof fetch;
}): Promise<{ authorizationUrl: URL }> {
  const issuer = normalizeIdpIssuer(params.idp.issuer);
  const metadata = await discoverIdpMetadata(issuer, params.fetchFn);
  const clientInformation = idpClientInformation(params.idp);
  const storageKey = idpOAuthStorageKey(issuer);
  const state = generateOAuthState();
  const issuerUrl = parseHttpUrl(issuer, "EMA IdP issuer (Client Settings)");
  const { authorizationUrl, codeVerifier } = await startAuthorization(
    issuerUrl,
    {
      metadata,
      clientInformation,
      redirectUrl: params.redirectUrl,
      scope: IDP_OIDC_SCOPES,
      state,
    },
  );
  await params.storage.saveCodeVerifier(storageKey, codeVerifier);
  await params.storage.savePreregisteredClientInformation(
    storageKey,
    clientInformation,
  );
  // Stash IdP metadata for token exchange on callback.
  await params.storage.saveServerMetadata(storageKey, metadata);
  return { authorizationUrl };
}

export async function completeIdpOidcAuthorization(params: {
  idp: EnterpriseManagedAuthIdpConfig;
  authorizationCode: string;
  redirectUrl: string;
  storage: OAuthStorage;
  fetchFn?: typeof fetch;
}): Promise<{
  idToken: string;
  refreshToken?: string;
  idTokenExpiresAt?: number;
}> {
  const issuer = normalizeIdpIssuer(params.idp.issuer);
  const storageKey = idpOAuthStorageKey(issuer);
  const metadata = params.storage.getServerMetadata(storageKey);
  if (!metadata) {
    throw new Error("IdP OAuth metadata not found — restart EMA IdP login");
  }
  const clientInformation =
    (await params.storage.getClientInformation(storageKey, true)) ??
    (await params.storage.getClientInformation(storageKey));
  if (!clientInformation) {
    throw new Error("IdP client information not found — restart EMA IdP login");
  }
  const codeVerifier = params.storage.getCodeVerifier(storageKey);
  if (!codeVerifier) {
    throw new Error("IdP PKCE verifier not found — restart EMA IdP login");
  }

  const issuerUrl = parseHttpUrl(issuer, "EMA IdP issuer (Client Settings)");
  const tokens = await exchangeAuthorization(issuerUrl, {
    metadata,
    clientInformation,
    authorizationCode: params.authorizationCode,
    codeVerifier,
    redirectUri: params.redirectUrl,
    fetchFn: params.fetchFn,
  });

  const idToken = tokens.id_token;
  if (!idToken) {
    throw new Error("IdP token response did not include an ID Token");
  }

  params.storage.clearCodeVerifier(storageKey);
  const idTokenExpiresAt = jwtExpiresAtMs(idToken);
  await params.storage.saveIdpSession(issuer, {
    idToken,
    refreshToken: tokens.refresh_token,
    idTokenExpiresAt,
  });

  return {
    idToken,
    refreshToken: tokens.refresh_token,
    idTokenExpiresAt,
  };
}

/** Redeem a cached IdP refresh token for a new ID Token (OIDC refresh grant). */
export async function refreshIdpOidcSession(params: {
  idp: EnterpriseManagedAuthIdpConfig;
  storage: OAuthStorage;
  fetchFn?: typeof fetch;
}): Promise<string> {
  const issuer = normalizeIdpIssuer(params.idp.issuer);
  const session = await params.storage.getIdpSession(issuer);
  if (!session?.refreshToken) {
    throw new Error("IdP refresh token not available");
  }

  const metadata = await resolveIdpMetadata(
    issuer,
    params.storage,
    params.fetchFn,
  );
  if (!metadata.token_endpoint) {
    throw new Error("IdP metadata missing token_endpoint");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
  });

  const response = await postOAuthTokenRequest(
    parseHttpUrl(
      metadata.token_endpoint,
      "IdP token_endpoint (from OIDC discovery)",
    ),
    body,
    metadata,
    idpClientInformation(params.idp),
    params.fetchFn,
  );
  if (!response.ok) {
    throw await parseOAuthTokenErrorResponse(
      response,
      "EMA IdP refresh (OIDC refresh_token grant)",
    );
  }

  const json = (await response.json()) as {
    id_token?: string;
    refresh_token?: string;
  };
  const idToken = json.id_token;
  if (!idToken) {
    throw new Error("IdP refresh did not return an ID Token");
  }

  await params.storage.saveIdpSession(issuer, {
    idToken,
    refreshToken: json.refresh_token ?? session.refreshToken,
    idTokenExpiresAt: jwtExpiresAtMs(idToken),
  });

  return idToken;
}

/**
 * Returns a non-expired IdP ID Token from storage, refreshing via refresh_token
 * when the cached ID Token has expired but a refresh token remains.
 */
export async function getValidIdToken(params: {
  idp: EnterpriseManagedAuthIdpConfig;
  storage: OAuthStorage;
  fetchFn?: typeof fetch;
}): Promise<string | undefined> {
  const issuer = normalizeIdpIssuer(params.idp.issuer);
  const session = await params.storage.getIdpSession(issuer);
  if (!session?.idToken) {
    return undefined;
  }
  if (!isJwtExpired(session.idToken)) {
    return session.idToken;
  }
  if (!session.refreshToken) {
    return undefined;
  }
  try {
    return await refreshIdpOidcSession(params);
  } catch {
    return undefined;
  }
}
