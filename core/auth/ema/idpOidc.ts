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
import { generateOAuthStateWithExecution, parseHttpUrl } from "../utils.js";
import { IDP_OIDC_SCOPES } from "./constants.js";
import { jwtExpiresAtMs } from "./jwt.js";
import { idpOAuthStorageKey } from "./storage.js";

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
  const issuer = params.idp.issuer.replace(/\/$/, "");
  const metadata = await discoverIdpMetadata(issuer, params.fetchFn);
  const clientInformation = {
    client_id: params.idp.clientId,
    client_secret: params.idp.clientSecret,
    token_endpoint_auth_method: "client_secret_post",
  } as OAuthClientInformation;
  const storageKey = idpOAuthStorageKey(issuer);
  const state = generateOAuthStateWithExecution("quick");
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
  const issuer = params.idp.issuer.replace(/\/$/, "");
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
