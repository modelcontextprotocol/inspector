/** OAuth storage key for in-flight IdP OIDC (PKCE, metadata). Not an OAuth `state` param prefix. */
export function idpOAuthStorageKey(issuer: string): string {
  return `ema-idp:${issuer.replace(/\/$/, "")}`;
}
