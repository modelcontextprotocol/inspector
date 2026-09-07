import type { OAuthClientProvider } from "@modelcontextprotocol/client";
import type {
  OAuthClientInformationContext,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthDiscoveryState,
  OAuthTokens,
} from "@modelcontextprotocol/client";
import type { BaseOAuthClientProvider } from "../providers.js";
import {
  refreshEmaResourceTokens,
  startEmaIdpAuthorization,
  type EmaFlowConfig,
} from "./emaFlow.js";
import { isJwtExpired } from "./jwt.js";

function isAccessTokenUsable(tokens: OAuthTokens, skewMs = 60_000): boolean {
  if (!tokens.access_token) return false;
  return !isJwtExpired(tokens.access_token, skewMs);
}

/**
 * OAuth provider for MCP transport when enterprise-managed authorization is enabled.
 *
 * Proactively refreshes resource tokens (EMA legs 2–3) via {@link tokens} before
 * requests. On 401 when the IdP session is still valid, the SDK {@link auth}
 * call may still reach {@link redirectToAuthorization}; we ignore the resource-AS
 * URL and redirect to the IdP instead.
 */
export class EmaTransportOAuthProvider implements OAuthClientProvider {
  private readonly inner: BaseOAuthClientProvider;
  private readonly emaConfig: EmaFlowConfig;

  constructor(inner: BaseOAuthClientProvider, emaConfig: EmaFlowConfig) {
    this.inner = inner;
    this.emaConfig = emaConfig;
  }

  get redirectUrl(): string {
    return this.inner.redirectUrl;
  }

  get clientMetadataUrl(): string | undefined {
    return this.inner.clientMetadataUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this.inner.clientMetadata;
  }

  state(): string | Promise<string> {
    return this.inner.state();
  }

  // SEP-2352: `ctx` carries the authorization-server `issuer` the SDK resolved,
  // and the inner provider keys registrations by it. Dropping it here made every
  // EMA read and write land on the unkeyed slot — and, since #2242, left
  // `resolveSdkRegistrationKind` with no issuer to check, so a CIMD registration
  // made over an EMA connection was recorded as DCR (Copilot).
  clientInformation(
    ctx?: OAuthClientInformationContext,
  ):
    | OAuthClientInformationMixed
    | undefined
    | Promise<OAuthClientInformationMixed | undefined> {
    return this.inner.clientInformation(ctx);
  }

  saveClientInformation(
    clientInformation: OAuthClientInformationMixed,
    ctx?: OAuthClientInformationContext,
  ): void | Promise<void> {
    return this.inner.saveClientInformation(clientInformation, ctx);
  }

  // Without these the SDK persists no discovery state for an EMA connection, so
  // it re-discovers on every call, cannot perform its SEP-2352 callback-leg
  // authorization-server binding check (it warns as much), and — since #2242 —
  // leaves the registration-kind resolver nothing to read back.
  saveDiscoveryState(state: OAuthDiscoveryState): void | Promise<void> {
    return this.inner.saveDiscoveryState(state);
  }

  discoveryState():
    | OAuthDiscoveryState
    | undefined
    | Promise<OAuthDiscoveryState | undefined> {
    return this.inner.discoveryState();
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const stored = await this.inner.tokens();
    if (stored && isAccessTokenUsable(stored)) {
      return stored;
    }
    const refreshed = await refreshEmaResourceTokens(this.emaConfig);
    if (refreshed) {
      return refreshed;
    }
    return undefined;
  }

  saveTokens(tokens: OAuthTokens): void | Promise<void> {
    return this.emaConfig.storage.saveTokens(this.emaConfig.serverUrl, tokens, {
      enterpriseManaged: true,
    });
  }

  async redirectToAuthorization(_authorizationUrl: URL): Promise<void> {
    const idpAuthorizationUrl = await startEmaIdpAuthorization(this.emaConfig);
    this.inner.clearCapturedAuthUrl();
    // The IdP is a different authorization server than the one the inner
    // provider was configured for, so the per-server custom authorization
    // parameters (#2018) must not be appended here — hence the "external"
    // entry point rather than `redirectToAuthorization`.
    this.inner.redirectToExternalAuthorization(idpAuthorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void | Promise<void> {
    return this.inner.saveCodeVerifier(codeVerifier);
  }

  codeVerifier(): string | Promise<string> {
    return this.inner.codeVerifier();
  }
}
