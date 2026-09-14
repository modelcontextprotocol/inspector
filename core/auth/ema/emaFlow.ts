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
import { resolvePersistedScopeAfterGrant } from "../scopes.js";

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

/**
 * A completed EMA mint, and the scope it actually asked for.
 *
 * The request is not always `config.scope`: with neither a configured nor a
 * stored scope, {@link discoverEmaResourceContext} resolves it from the
 * protected resource metadata's `scopes_supported`, and that is what both
 * exchanges send. Callers need the resolved value to apply RFC 6749 §5.1 — a
 * token response that omits `scope` granted exactly what was requested.
 */
export interface EmaMintResult {
  tokens: OAuthTokens;
  requestedScope?: string;
}

export async function mintEmaResourceTokens(
  config: EmaFlowConfig,
  resourceContext?: EmaResourceContext,
): Promise<EmaMintResult> {
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
  // SDK leg-2 helper requires `resource` on the wire; fall back to PRM `resource`.
  const resource = ctx.resourceUrl?.href ?? ctx.resourceMetadata.resource;
  const idJag = await exchangeIdJag({
    idp: config.idp,
    idToken,
    audience,
    resource,
    scope: ctx.scope,
    fetchFn: config.fetchFn,
  });

  const tokens = await redeemIdJagForAccessToken({
    resourceAsUrl: ctx.resourceAsUrl,
    idJag,
    resourceClientId: config.resourceClientId,
    resourceClientSecret: config.resourceClientSecret,
    resource: ctx.resourceUrl?.href,
    scope: ctx.scope,
    fetchFn: config.fetchFn,
  });
  return { tokens, requestedScope: ctx.scope };
}

/**
 * Save a mint's tokens and the scope they carry, together.
 *
 * Every EMA mint ends here — silent, refresh, and interactive alike — because
 * all three can be the moment a newly configured or metadata-derived scope
 * first takes effect. Persisting tokens without the scope leaves the previous
 * stored value standing as though it described the new token (#2117).
 */
async function saveMintedTokens(
  config: EmaFlowConfig,
  { tokens, requestedScope }: EmaMintResult,
): Promise<void> {
  await config.storage.saveTokens(config.serverUrl, tokens, {
    enterpriseManaged: true,
  });
  const scopeToPersist = resolvePersistedScopeAfterGrant(
    tokens.scope,
    requestedScope,
  );
  if (scopeToPersist) {
    await config.storage.saveScope(config.serverUrl, scopeToPersist);
  }
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
    await saveMintedTokens(config, await mintEmaResourceTokens(config));
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
): Promise<EmaMintResult> {
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

  let minted: EmaMintResult;
  try {
    minted = await mintEmaResourceTokens(config);
  } catch (err) {
    throw wrapEmaMintError(err);
  }

  await saveMintedTokens(config, minted);
  return minted;
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
  const minted = await mintEmaResourceTokens(config);
  await saveMintedTokens(config, minted);
  return minted.tokens;
}
