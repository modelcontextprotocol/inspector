/** Strip trailing slash so issuer URLs match across discovery, storage keys, and sessions. */
export function normalizeIdpIssuer(issuer: string): string {
  return issuer.replace(/\/$/, "");
}

/** Prefix that distinguishes an EMA IdP OIDC record from a server URL in the shared OAuth store. */
export const IDP_OAUTH_KEY_PREFIX = "ema-idp:";

/** OAuth storage key for in-flight IdP OIDC (PKCE, metadata). Not an OAuth `state` param prefix. */
export function idpOAuthStorageKey(issuer: string): string {
  return `${IDP_OAUTH_KEY_PREFIX}${normalizeIdpIssuer(issuer)}`;
}

/** Inverse of {@link idpOAuthStorageKey}: the issuer for an IdP key, else `null`. */
export function parseIdpOAuthStorageKey(key: string): string | null {
  return key.startsWith(IDP_OAUTH_KEY_PREFIX)
    ? key.slice(IDP_OAUTH_KEY_PREFIX.length)
    : null;
}
