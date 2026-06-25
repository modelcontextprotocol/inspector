import type {
  OAuthClientInformation,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { EnterpriseManagedAuthIdpConfig } from "../client/types.js";
import { getEmaIdpLoginState, normalizeIdpIssuer } from "./ema/idpSession.js";
import { idpOAuthStorageKey } from "./ema/storage.js";
import { isJwtExpired } from "./ema/jwt.js";
import type { OAuthStorage } from "./storage.js";
import type { AuthProtocol, OAuthConnectionState, OAuthFlowState } from "./types.js";
import { authProtocolFromEnterpriseManaged } from "./types.js";

export interface BuildOAuthConnectionStateParams {
  serverUrl: string;
  protocol: AuthProtocol;
  configuredScope?: string;
  enterpriseManagedAuth?: { idp: EnterpriseManagedAuthIdpConfig };
  storage: OAuthStorage;
  flowState?: OAuthFlowState;
}

function isAccessTokenUsable(tokens: OAuthTokens | undefined): boolean {
  if (!tokens?.access_token) return false;
  return !isJwtExpired(tokens.access_token);
}

function resolveClient(
  preregistered: OAuthClientInformation | undefined,
  dynamic: OAuthClientInformation | undefined,
): OAuthConnectionState["client"] | undefined {
  const info = preregistered ?? dynamic;
  if (!info?.client_id) return undefined;
  return {
    source: preregistered ? "preregistered" : "dynamic",
    clientId: info.client_id,
    hasClientSecret: info.client_secret !== undefined && info.client_secret !== "",
  };
}

function resolveGrantedScope(
  tokens: OAuthTokens | undefined,
  storageScope: string | undefined,
): string | undefined {
  const tokenScope =
    typeof tokens?.scope === "string" ? tokens.scope.trim() : undefined;
  if (tokenScope) return tokenScope;
  const stored =
    typeof storageScope === "string" ? storageScope.trim() : undefined;
  return stored || undefined;
}

/**
 * Assembles persisted OAuth connection state for an HTTP MCP server.
 * Reads storage and config only — no network discovery.
 */
export async function buildOAuthConnectionState(
  params: BuildOAuthConnectionStateParams,
): Promise<OAuthConnectionState> {
  const { serverUrl, storage, flowState } = params;
  const protocol = params.protocol;

  const storedTokens = await storage.getTokens(serverUrl);
  const flowTokens = flowState?.oauthTokens ?? undefined;
  const tokens =
    flowTokens && isAccessTokenUsable(flowTokens)
      ? flowTokens
      : storedTokens && isAccessTokenUsable(storedTokens)
        ? storedTokens
        : flowTokens ?? storedTokens;

  const preregistered = await storage.getClientInformation(serverUrl, true);
  const dynamic = await storage.getClientInformation(serverUrl);
  const storageScope = storage.getScope(serverUrl);
  const serverMetadata = storage.getServerMetadata(serverUrl);

  const authorized = isAccessTokenUsable(tokens);
  const grantedScope = resolveGrantedScope(tokens, storageScope);

  const client = resolveClient(preregistered, dynamic);

  const state: OAuthConnectionState = {
    authorized,
    protocol,
    serverUrl,
    ...(params.configuredScope?.trim() && {
      configuredScope: params.configuredScope.trim(),
    }),
    ...(grantedScope && { grantedScope }),
    ...(tokens && { tokens }),
    ...(client && { client }),
    ...(serverMetadata && { authorizationServerMetadata: serverMetadata }),
  };

  if (protocol === "ema" && params.enterpriseManagedAuth?.idp) {
    const idp = params.enterpriseManagedAuth.idp;
    const issuer = normalizeIdpIssuer(idp.issuer);
    const idpSession = await getEmaIdpLoginState(storage, issuer);
    const idpMetadata = storage.getServerMetadata(idpOAuthStorageKey(issuer));
    state.ema = {
      idpIssuer: issuer,
      idpClientId: idp.clientId,
      idpSession,
      ...(idpMetadata && { idpMetadata }),
    };
    state.enterpriseManaged = true;
  }

  return state;
}

/** Whether server-level OAuth options are configured on the client. */
export function isServerOAuthConfigured(config: {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  enterpriseManaged?: boolean;
}): boolean {
  return (
    config.enterpriseManaged === true ||
    !!config.clientId?.trim() ||
    !!config.clientSecret?.trim() ||
    !!config.scope?.trim()
  );
}

export function protocolFromOAuthConfig(config: {
  enterpriseManaged?: boolean;
}): AuthProtocol {
  return authProtocolFromEnterpriseManaged(config.enterpriseManaged);
}
