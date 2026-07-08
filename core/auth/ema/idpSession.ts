import type { OAuthStorage } from "../storage.js";
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

export async function clearEmaIdpSession(
  storage: OAuthStorage,
  issuer: string,
): Promise<void> {
  const normalized = normalizeIdpIssuer(issuer);
  if (!normalized) return;
  await storage.clearIdpSession(normalized);
  await storage.clear(idpOAuthStorageKey(normalized));
  await storage.clearEnterpriseManagedResourceServers();
}
