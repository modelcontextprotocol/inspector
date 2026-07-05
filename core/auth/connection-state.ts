import type {
  OAuthClientInformation,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { EnterpriseManagedAuthIdpConfig } from "../client/types.js";
import { getEmaIdpLoginState, normalizeIdpIssuer } from "./ema/idpSession.js";
import { idpOAuthStorageKey } from "./ema/storage.js";
import { isJwtExpired } from "./ema/jwt.js";
import type { OAuthStorage } from "./storage.js";
import type { AuthProtocol, OAuthClientRegistrationKind, OAuthConnectionState, OAuthFlowState } from "./types.js";
import { authProtocolFromEnterpriseManaged } from "./types.js";

export interface BuildOAuthConnectionStateParams {
  serverUrl: string;
  protocol: AuthProtocol;
  configuredScope?: string;
  enterpriseManagedAuth?: { idp: EnterpriseManagedAuthIdpConfig };
  storage: OAuthStorage;
  flowState?: OAuthFlowState;
}

/** True when persisted tokens include a non-expired access token (JWT exp when parseable). */
export function isAccessTokenUsable(
  tokens: OAuthTokens | undefined,
): boolean {
  if (!tokens?.access_token) return false;
  return !isJwtExpired(tokens.access_token);
}

function resolveClient(
  preregistered: OAuthClientInformation | undefined,
  dynamic: OAuthClientInformation | undefined,
  dynamicRegistrationKind: Extract<
    OAuthClientRegistrationKind,
    "dcr" | "cimd"
  > | undefined,
): OAuthConnectionState["client"] | undefined {
  if (preregistered?.client_id) {
    return {
      registrationKind: "static",
      clientId: preregistered.client_id,
      hasClientSecret:
        preregistered.client_secret !== undefined &&
        preregistered.client_secret !== "",
    };
  }
  if (!dynamic?.client_id) return undefined;
  return {
    ...(dynamicRegistrationKind && {
      registrationKind: dynamicRegistrationKind,
    }),
    clientId: dynamic.client_id,
    hasClientSecret:
      dynamic.client_secret !== undefined && dynamic.client_secret !== "",
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
  const storageScope = await storage.getScope(serverUrl);
  const serverMetadata = await storage.getServerMetadata(serverUrl);

  const authorized = isAccessTokenUsable(tokens);
  const grantedScope = resolveGrantedScope(tokens, storageScope);

  const registrationKind = await storage.getClientRegistrationKind(serverUrl);
  const dynamicRegistrationKind =
    registrationKind === "dcr" || registrationKind === "cimd"
      ? registrationKind
      : undefined;

  const client = resolveClient(
    preregistered,
    dynamic,
    preregistered?.client_id ? undefined : dynamicRegistrationKind,
  );

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
    const idpMetadata = await storage.getServerMetadata(idpOAuthStorageKey(issuer));
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
  clientMetadataUrl?: string;
}): boolean {
  return (
    config.enterpriseManaged === true ||
    !!config.clientId?.trim() ||
    !!config.clientSecret?.trim() ||
    !!config.scope?.trim() ||
    !!config.clientMetadataUrl?.trim()
  );
}

/** True when persisted OAuth storage has tokens or client registration for a server. */
export async function hasPersistedOAuthServerState(
  storage: OAuthStorage,
  serverUrl: string,
): Promise<boolean> {
  const [tokens, preregistered, dynamic] = await Promise.all([
    storage.getTokens(serverUrl),
    storage.getClientInformation(serverUrl, true),
    storage.getClientInformation(serverUrl),
  ]);
  return !!(
    tokens?.access_token ||
    preregistered?.client_id ||
    dynamic?.client_id
  );
}

export function protocolFromOAuthConfig(config: {
  enterpriseManaged?: boolean;
}): AuthProtocol {
  return authProtocolFromEnterpriseManaged(config.enterpriseManaged);
}
