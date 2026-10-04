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

export interface ClearEmaIdpSessionResult {
  /**
   * OIDC RP-initiated logout URL (`end_session_endpoint` +
   * `id_token_hint`), for the caller to relay to a human whose browser
   * holds the IdP SSO cookie the local clear cannot touch. Present only
   * when a session with an idToken existed and the IdP's login-time
   * discovery metadata (cached in storage) advertises the endpoint.
   */
  endSessionUrl?: string;
}

/**
 * Clear the inspector-local EMA IdP state: the cached IdP OIDC session, the
 * leg-1 pending key, and every EMA-tagged resource-server entry. Local-only
 * and network-free — the IdP's own browser SSO session is untouched; the
 * returned `endSessionUrl` (when the IdP advertises one) lets the caller
 * offer that step.
 */
export async function clearEmaIdpSession(
  storage: OAuthStorage,
  issuer: string,
): Promise<ClearEmaIdpSessionResult> {
  const normalized = normalizeIdpIssuer(issuer);
  if (!normalized) return {};
  // Read before clearing: the end-session URL needs the session's idToken
  // (as id_token_hint) and the login-time discovery metadata cached under
  // the leg-1 key — the clears below destroy both.
  const idToken = (await storage.getIdpSession(normalized))?.idToken;
  const metadata = await storage.getServerMetadata(
    idpOAuthStorageKey(normalized),
  );
  await storage.clearIdpSession(normalized);
  await storage.clear(idpOAuthStorageKey(normalized));
  await storage.clearEnterpriseManagedResourceServers();
  if (!idToken || !metadata) return {};
  const endSessionUrl = buildEndSessionUrl(metadata, idToken);
  return endSessionUrl === undefined ? {} : { endSessionUrl };
}

/**
 * RP-initiated logout URL from the IdP's cached discovery metadata.
 * `end_session_endpoint` is an OIDC RP-Initiated Logout field; the SDK's
 * RFC 8414 schema does not declare it but parses with a loose object, so it
 * survives into the cached metadata as an untyped extra key — narrow it
 * ourselves. The URL carries the ID token (`id_token_hint`), so a plain-http
 * endpoint is rejected unless its host is loopback (the same exemption the
 * SDK applies to token endpoints) — never offer a logout URL that would send
 * the token in cleartext.
 */
function buildEndSessionUrl(
  metadata: object,
  idToken: string,
): string | undefined {
  const endpoint = (metadata as { end_session_endpoint?: unknown })
    .end_session_endpoint;
  if (typeof endpoint !== "string") return undefined;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLoopbackHost(url.hostname))
  ) {
    return undefined;
  }
  url.searchParams.set("id_token_hint", idToken);
  return url.toString();
}

/** The SDK's loopback exemption list: localhost, 127.0.0.1, ::1. */
function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}
