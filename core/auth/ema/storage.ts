/** Strip trailing slash so issuer URLs match across discovery, storage keys, and sessions. */
export function normalizeIdpIssuer(issuer: string): string {
  return issuer.replace(/\/$/, "");
}

/** OAuth storage key for in-flight IdP OIDC (PKCE, metadata). Not an OAuth `state` param prefix. */
export function idpOAuthStorageKey(issuer: string): string {
  return `ema-idp:${normalizeIdpIssuer(issuer)}`;
}
