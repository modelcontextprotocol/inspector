import type { OAuthTokens } from "@modelcontextprotocol/client";
import type { OAuthStorage } from "../storage.js";
import type { EnterpriseManagedAuthIdpConfig } from "../../client/types.js";
import {
  completeIdpOidcAuthorization,
  getValidIdToken,
  startIdpOidcAuthorization,
} from "./idpOidc.js";
import {
  discoverEmaResourceContext,
  type EmaResourceContext,
} from "./resourceContext.js";
import { exchangeIdJag, redeemIdJagForAccessToken } from "./wire.js";

export interface EmaFlowConfig {
  serverUrl: string;
  idp: EnterpriseManagedAuthIdpConfig;
  resourceClientId?: string;
  resourceClientSecret?: string;
  scope?: string;
  redirectUrl: string;
  storage: OAuthStorage;
  fetchFn?: typeof fetch;
}

export type TrySilentEmaAuthResult =
  | { status: "success" }
  | { status: "no_idp_session" }
  | { status: "mint_failed"; error: Error };

function wrapEmaMintError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`EMA legs 2–3 (resource token mint): ${message}`, {
    cause: err,
  });
}

export async function mintEmaResourceTokens(
  config: EmaFlowConfig,
  resourceContext?: EmaResourceContext,
): Promise<OAuthTokens> {
  const ctx =
    resourceContext ??
    (await discoverEmaResourceContext(
      config.serverUrl,
      config.scope,
      config.fetchFn,
    ));
  if (!config.resourceClientId) {
    throw new Error(
      "EMA requires resource authorization server clientId (per-server oauth.clientId)",
    );
  }
  if (!config.resourceClientSecret?.trim()) {
    throw new Error(
      "EMA requires resource authorization server client secret in server OAuth settings (Test Client secret from xaa.dev resource registration)",
    );
  }

  const idToken = await getValidIdToken({
    idp: config.idp,
    storage: config.storage,
    fetchFn: config.fetchFn,
  });
  if (!idToken) {
    throw new Error("Valid IdP ID Token required for EMA token mint");
  }

  const audience = ctx.resourceAsUrl.href.replace(/\/$/, "");
  const idJag = await exchangeIdJag({
    idp: config.idp,
    idToken,
    audience,
    resource: ctx.resourceUrl?.href,
    scope: ctx.scope,
    fetchFn: config.fetchFn,
  });

  return redeemIdJagForAccessToken({
    resourceAsUrl: ctx.resourceAsUrl,
    idJag,
    resourceClientId: config.resourceClientId,
    resourceClientSecret: config.resourceClientSecret,
    resource: ctx.resourceUrl?.href,
    scope: ctx.scope,
    fetchFn: config.fetchFn,
  });
}

/** Silent path: cached IdP session + legs 2–3. */
export async function trySilentEmaAuth(
  config: EmaFlowConfig,
): Promise<TrySilentEmaAuthResult> {
  const idToken = await getValidIdToken({
    idp: config.idp,
    storage: config.storage,
    fetchFn: config.fetchFn,
  });
  if (!idToken) {
    return { status: "no_idp_session" };
  }
  try {
    const tokens = await mintEmaResourceTokens(config);
    await config.storage.saveTokens(config.serverUrl, tokens, {
      enterpriseManaged: true,
    });
    return { status: "success" };
  } catch (err) {
    return { status: "mint_failed", error: wrapEmaMintError(err) };
  }
}

export async function startEmaIdpAuthorization(
  config: EmaFlowConfig,
): Promise<URL> {
  const { authorizationUrl } = await startIdpOidcAuthorization({
    idp: config.idp,
    redirectUrl: config.redirectUrl,
    storage: config.storage,
    fetchFn: config.fetchFn,
  });
  return authorizationUrl;
}

export async function completeEmaIdpAuthorizationAndMint(
  config: EmaFlowConfig,
  authorizationCode: string,
  iss?: string,
): Promise<OAuthTokens> {
  try {
    await completeIdpOidcAuthorization({
      idp: config.idp,
      authorizationCode,
      iss,
      redirectUrl: config.redirectUrl,
      storage: config.storage,
      fetchFn: config.fetchFn,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`EMA leg 1 (IdP authorization code exchange): ${message}`, {
      cause: err,
    });
  }

  let tokens: OAuthTokens;
  try {
    tokens = await mintEmaResourceTokens(config);
  } catch (err) {
    throw wrapEmaMintError(err);
  }

  await config.storage.saveTokens(config.serverUrl, tokens, {
    enterpriseManaged: true,
  });
  return tokens;
}

/** Re-run legs 2–3 on 401 when IdP session is still valid. */
export async function refreshEmaResourceTokens(
  config: EmaFlowConfig,
): Promise<OAuthTokens | undefined> {
  const idToken = await getValidIdToken({
    idp: config.idp,
    storage: config.storage,
    fetchFn: config.fetchFn,
  });
  if (!idToken) {
    return undefined;
  }
  const tokens = await mintEmaResourceTokens(config);
  await config.storage.saveTokens(config.serverUrl, tokens, {
    enterpriseManaged: true,
  });
  return tokens;
}
