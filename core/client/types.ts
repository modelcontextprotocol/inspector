/**
 * Install-level client configuration (IdP / EMA settings, later client identity).
 * Persisted in ~/.mcp-inspector/storage/client.json via /api/storage/client.
 */

/** OIDC client credentials for the enterprise IdP (legs 1–2). */
export interface EnterpriseManagedAuthIdpConfig {
  issuer: string;
  clientId: string;
  /** Present after keychain merge; omitted from on-disk client.json. */
  clientSecret?: string;
}

export interface ClientConfig {
  enterpriseManagedAuth?: {
    /** When false, IdP credentials are kept but EMA is inactive install-wide. */
    enabled?: boolean;
    idp: EnterpriseManagedAuthIdpConfig;
  };
}

/** True when install-level EMA IdP config is active (not just stored). */
export function isEnterpriseManagedAuthEnabled(
  config: ClientConfig,
): boolean {
  const ema = config.enterpriseManagedAuth;
  if (!ema?.idp) return false;
  return ema.enabled !== false;
}

export function getActiveEnterpriseManagedAuthIdp(
  config: ClientConfig,
): EnterpriseManagedAuthIdpConfig | undefined {
  if (!isEnterpriseManagedAuthEnabled(config)) return undefined;
  return config.enterpriseManagedAuth!.idp;
}
