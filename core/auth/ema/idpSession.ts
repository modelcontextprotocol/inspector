import type { OAuthStorage } from "../storage.js";
import { discoverIdpMetadata } from "./idpOidc.js";
import { isJwtExpired } from "./jwt.js";
import { idpOAuthStorageKey, normalizeIdpIssuer } from "./storage.js";

export type EmaIdpLoginState = "none" | "logged_in" | "expired";

export { normalizeIdpIssuer };

/** Whether a cached IdP OIDC session exists for the configured issuer. */
export async function getEmaIdpLoginState(
  storage: OAuthStorage,
  issuer: string,
): Promise<EmaIdpLoginState> {
  const normalized = normalizeIdpIssuer(issuer);
  if (!normalized) return "none";

  const session = await storage.getIdpSession(normalized);
  if (!session?.idToken) return "none";
  if (!isJwtExpired(session.idToken)) return "logged_in";
  if (session.refreshToken) return "logged_in";
  return "expired";
}

export interface ClearEmaIdpSessionResult {
  /**
   * OIDC RP-initiated logout URL (`end_session_endpoint` +
   * `id_token_hint`), for the caller to relay to a human whose browser
   * holds the IdP SSO cookie the local clear cannot touch. Present only
   * when `buildEndSessionUrl` was requested, a session with an idToken
   * existed, and the issuer's discovery metadata advertises the endpoint.
   */
  endSessionUrl?: string;
}

export interface ClearEmaIdpSessionOptions {
  /**
   * Also build the IdP end-session URL (one best-effort discovery fetch).
   * Off by default so existing sign-out callers stay network-free.
   */
  buildEndSessionUrl?: boolean;
  fetchFn?: typeof fetch;
}

/**
 * Clear the inspector-local EMA IdP state: the cached IdP OIDC session, the
 * leg-1 pending key, and every EMA-tagged resource-server entry. Local-only —
 * the IdP's own browser SSO session is untouched; `buildEndSessionUrl`
 * returns the RP-initiated logout URL so the caller can offer that step.
 */
export async function clearEmaIdpSession(
  storage: OAuthStorage,
  issuer: string,
  options?: ClearEmaIdpSessionOptions,
): Promise<ClearEmaIdpSessionResult> {
  const normalized = normalizeIdpIssuer(issuer);
  if (!normalized) return {};
  // Read before clearing: the end-session URL carries the session's idToken
  // as id_token_hint, and the clears below destroy it. Folding the read into
  // the clear (rather than a separate helper) is what makes the ordering
  // impossible to get wrong at a call site.
  let idToken: string | undefined;
  if (options?.buildEndSessionUrl) {
    idToken = (await storage.getIdpSession(normalized))?.idToken;
  }
  await storage.clearIdpSession(normalized);
  await storage.clear(idpOAuthStorageKey(normalized));
  await storage.clearEnterpriseManagedResourceServers();
  if (!idToken) return {};
  const endSessionUrl = await buildEndSessionUrl(
    normalized,
    idToken,
    options?.fetchFn,
  );
  return endSessionUrl === undefined ? {} : { endSessionUrl };
}

/**
 * Best-effort RP-initiated logout URL for `issuer`. Never throws: the clear
 * has already happened, and a discovery failure or an IdP that advertises no
 * `end_session_endpoint` simply means there is no URL to offer.
 */
async function buildEndSessionUrl(
  issuer: string,
  idToken: string,
  fetchFn?: typeof fetch,
): Promise<string | undefined> {
  try {
    const metadata = await discoverIdpMetadata(issuer, fetchFn);
    // `end_session_endpoint` is an OIDC RP-Initiated Logout field; the SDK's
    // RFC 8414 schema does not declare it but parses with a loose object, so
    // it survives as an untyped extra key. Narrow it ourselves.
    const endpoint = (metadata as { end_session_endpoint?: unknown })
      .end_session_endpoint;
    if (typeof endpoint !== "string") return undefined;
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
    url.searchParams.set("id_token_hint", idToken);
    return url.toString();
  } catch {
    return undefined;
  }
}
