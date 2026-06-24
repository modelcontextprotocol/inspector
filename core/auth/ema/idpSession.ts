import type { OAuthStorage } from "../storage.js";
import { isJwtExpired } from "./jwt.js";
import { idpOAuthStorageKey } from "./storage.js";

export type EmaIdpLoginState = "none" | "logged_in" | "expired";

export function normalizeIdpIssuer(issuer: string): string {
  return issuer.replace(/\/$/, "");
}

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

export function clearEmaIdpSession(storage: OAuthStorage, issuer: string): void {
  const normalized = normalizeIdpIssuer(issuer);
  if (!normalized) return;
  storage.clearIdpSession(normalized);
  storage.clear(idpOAuthStorageKey(normalized));
  storage.clearEnterpriseManagedResourceServers();
}
