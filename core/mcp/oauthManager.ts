/**
 * Internal OAuth sub-manager for InspectorClient.
 * Holds OAuth config and in-memory flow state; orchestrates authenticate() / completeOAuthFlow().
 * Not part of the public API; InspectorClient delegates to this module.
 */

import { BaseOAuthClientProvider } from "../auth/providers.js";
import type { OAuthFlowState, OAuthStep } from "../auth/types.js";
import { EMPTY_OAUTH_FLOW_STATE } from "../auth/types.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientInformation } from "@modelcontextprotocol/sdk/shared/auth.js";
import { mcpAuth } from "../auth/mcpAuth.js";
import { parseOAuthState } from "../auth/utils.js";
import type { EnterpriseManagedAuthIdpConfig } from "../client/types.js";
import type { ClientConfig } from "../client/types.js";
import { EmaClientNotConfiguredError } from "../auth/ema/clientConfigError.js";
import {
  completeEmaIdpAuthorizationAndMint,
  refreshEmaResourceTokens,
  startEmaIdpAuthorization,
  trySilentEmaAuth,
  type EmaFlowConfig,
} from "../auth/ema/emaFlow.js";
import {
  buildOAuthConnectionState,
  hasPersistedOAuthServerState,
  isAccessTokenUsable,
  isServerOAuthConfigured,
  protocolFromOAuthConfig,
} from "../auth/connection-state.js";
import { ensureCimdClientRegistration } from "../auth/cimd.js";
import type { OAuthConnectionState } from "../auth/types.js";
import { EmaTransportOAuthProvider } from "../auth/ema/transportProvider.js";
import type {
  AuthChallenge,
  AuthChallengeOutcome,
  HandleAuthChallengeOptions,
} from "../auth/challenge.js";
import {
  parseScopeString,
  unionAuthorizationScopes,
} from "../auth/challenge.js";
import {
  computeScopeUnion,
  isStrictScopeSuperset,
} from "../auth/scopes.js";
import { stepUpInsufficientScopeMessage } from "../auth/oauthUx.js";
import type {
  InspectorClientEnvironment,
  InspectorClientOptions,
} from "./types.js";

export type OAuthManagerConfig = NonNullable<InspectorClientOptions["oauth"]> &
  NonNullable<InspectorClientEnvironment["oauth"]>;

export interface OAuthManagerParams {
  getServerUrl: () => string;
  effectiveAuthFetch: typeof fetch;
  getEventTarget: () => EventTarget;
  onBeforeOAuthRedirect?: (sessionId: string) => Promise<void>;
  initialConfig: OAuthManagerConfig;
  enterpriseManagedAuth?: { idp: EnterpriseManagedAuthIdpConfig };
  /** Install-level EMA block (including when disabled) for user-facing errors. */
  installEnterpriseManagedAuth?: ClientConfig["enterpriseManagedAuth"];
  dispatchOAuthComplete: (detail: { tokens: OAuthTokens }) => void;
  dispatchOAuthAuthorizationRequired: (detail: { url: URL }) => void;
  dispatchOAuthError: (detail: { error: Error }) => void;
}

/**
 * Internal manager for OAuth flow orchestration.
 * InspectorClient creates this when oauth is configured and delegates all OAuth methods.
 */
export class OAuthManager {
  private params: OAuthManagerParams;
  private oauthConfig: OAuthManagerConfig;
  private oauthFlowState: OAuthFlowState | null = null;
  /** SEP-2350 union scope pending until interactive step-up completes. */
  private pendingAuthorizationScope: string | undefined;
  private authChallengeMutex: Promise<void> = Promise.resolve();

  constructor(params: OAuthManagerParams) {
    this.params = params;
    this.oauthConfig = { ...params.initialConfig };
    this.pendingAuthorizationScope = undefined;
  }

  setOAuthConfig(config: {
    clientId?: string;
    clientSecret?: string;
    clientMetadataUrl?: string;
    scope?: string;
    enterpriseManaged?: boolean;
  }): void {
    this.oauthConfig = {
      ...this.oauthConfig,
      ...config,
    } as OAuthManagerConfig;
  }

  private getServerUrl(): string {
    return this.params.getServerUrl();
  }

  private async createOAuthProvider(): Promise<BaseOAuthClientProvider> {
    if (
      !this.oauthConfig.storage ||
      !this.oauthConfig.redirectUrlProvider ||
      !this.oauthConfig.navigation
    ) {
      throw new Error(
        "OAuth environment components (storage, navigation, redirectUrlProvider) are required.",
      );
    }

    const serverUrl = this.getServerUrl();
    const provider = new BaseOAuthClientProvider(serverUrl, {
      storage: this.oauthConfig.storage,
      redirectUrlProvider: this.oauthConfig.redirectUrlProvider,
      navigation: this.oauthConfig.navigation,
      clientMetadataUrl: this.oauthConfig.clientMetadataUrl,
    });

    provider.setEventTarget(this.params.getEventTarget());

    const storedScope = this.oauthConfig.storage.getScope(serverUrl);
    if (storedScope === undefined && this.oauthConfig.scope) {
      await provider.saveScope(this.oauthConfig.scope);
    }

    if (this.oauthConfig.clientId) {
      const clientInfo: OAuthClientInformation = {
        client_id: this.oauthConfig.clientId,
        ...(this.oauthConfig.clientSecret && {
          client_secret: this.oauthConfig.clientSecret,
        }),
      };
      await provider.savePreregisteredClientInformation(clientInfo);
    }

    return provider;
  }

  /** Whether this connection uses enterprise-managed authorization (EMA). */
  isEnterpriseManaged(): boolean {
    return this.oauthConfig.enterpriseManaged === true;
  }

  private getEmaFlowConfig(): EmaFlowConfig {
    if (!this.oauthConfig.storage || !this.oauthConfig.redirectUrlProvider) {
      throw new Error(
        "OAuth environment components (storage, redirectUrlProvider) are required.",
      );
    }
    const idp = this.params.enterpriseManagedAuth?.idp;
    if (!idp) {
      const install = this.params.installEnterpriseManagedAuth;
      throw new EmaClientNotConfiguredError(
        install?.enabled === false && install.idp
          ? "disabled"
          : "not_configured",
      );
    }
    return {
      serverUrl: this.getServerUrl(),
      idp,
      resourceClientId: this.oauthConfig.clientId,
      resourceClientSecret: this.oauthConfig.clientSecret,
      scope:
        computeScopeUnion(
          this.oauthConfig.scope,
          this.oauthConfig.storage.getScope(this.getServerUrl()),
        ) || this.oauthConfig.scope,
      redirectUrl: this.oauthConfig.redirectUrlProvider.getRedirectUrl(),
      storage: this.oauthConfig.storage,
      fetchFn: this.params.effectiveAuthFetch,
    };
  }

  /** Attempt silent EMA (cached IdP session + legs 2–3). */
  async trySilentEnterpriseManagedAuth(): Promise<boolean> {
    if (!this.isEnterpriseManaged()) return false;
    const result = await trySilentEmaAuth(this.getEmaFlowConfig());
    if (result.status === "success") return true;
    if (result.status === "mint_failed") throw result.error;
    return false;
  }

  private async authenticateEnterpriseManaged(): Promise<URL | undefined> {
    const config = this.getEmaFlowConfig();
    const silent = await trySilentEmaAuth(config);
    if (silent.status === "success") {
      return undefined;
    }
    if (silent.status === "mint_failed") {
      throw silent.error;
    }

    const authorizationUrl = await startEmaIdpAuthorization(config);
    const stateParam = authorizationUrl.searchParams.get("state");
    if (stateParam && this.params.onBeforeOAuthRedirect) {
      const parsedState = parseOAuthState(stateParam);
      if (parsedState?.authId) {
        await this.params.onBeforeOAuthRedirect(parsedState.authId);
      }
    }

    this.requireNavigation().navigateToAuthorization(authorizationUrl);
    await this.recordAuthorizationCodeFlowState(authorizationUrl);
    return authorizationUrl;
  }

  async authenticate(): Promise<URL | undefined> {
    if (this.isEnterpriseManaged()) {
      return this.authenticateEnterpriseManaged();
    }

    const provider = await this.createOAuthProvider();
    const serverUrl = this.getServerUrl();

    provider.clearCapturedAuthUrl();

    await ensureCimdClientRegistration({
      serverUrl,
      provider,
      fetchFn: this.params.effectiveAuthFetch,
    });

    const result = await mcpAuth(provider, {
      serverUrl,
      scope: provider.scope,
      fetchFn: this.params.effectiveAuthFetch,
    });

    if (result === "AUTHORIZED") {
      throw new Error(
        "Unexpected: auth() returned AUTHORIZED without authorization code",
      );
    }

    const capturedUrl = provider.getCapturedAuthUrl();
    if (!capturedUrl) {
      throw new Error("Failed to capture authorization URL");
    }

    const stateParam = capturedUrl.searchParams.get("state");
    if (stateParam && this.params.onBeforeOAuthRedirect) {
      const parsedState = parseOAuthState(stateParam);
      if (parsedState?.authId) {
        await this.params.onBeforeOAuthRedirect(parsedState.authId);
      }
    }

    const clientInfo = await provider.clientInformation();
    this.oauthFlowState = {
      ...EMPTY_OAUTH_FLOW_STATE,
      oauthStep: "authorization_code",
      authorizationUrl: capturedUrl,
      oauthClientInfo: clientInfo ?? null,
    };
    return capturedUrl;
  }

  async completeOAuthFlow(
    authorizationCode: string,
    iss?: string,
  ): Promise<void> {
    try {
      if (this.isEnterpriseManaged()) {
        const scopeForMint =
          this.pendingAuthorizationScope ?? this.getEmaFlowConfig().scope;
        const config = scopeForMint
          ? { ...this.getEmaFlowConfig(), scope: scopeForMint }
          : this.getEmaFlowConfig();
        const tokens = await completeEmaIdpAuthorizationAndMint(
          config,
          authorizationCode,
        );
        if (this.pendingAuthorizationScope) {
          await this.oauthConfig.storage!.saveScope(
            this.getServerUrl(),
            this.pendingAuthorizationScope,
          );
        }
        this.pendingAuthorizationScope = undefined;
        const completedAt = Date.now();
        this.oauthFlowState = {
          ...EMPTY_OAUTH_FLOW_STATE,
          oauthStep: "complete",
          oauthTokens: tokens,
          completedAt,
        };
        this.params.dispatchOAuthComplete({ tokens });
        return;
      }

      const provider = await this.createOAuthProvider();
      const serverUrl = this.getServerUrl();

      const result = await mcpAuth(provider, {
        serverUrl,
        authorizationCode,
        iss,
        fetchFn: this.params.effectiveAuthFetch,
      });

      if (result !== "AUTHORIZED") {
        throw new Error(
          `Expected AUTHORIZED after providing authorization code, got: ${result}`,
        );
      }

      const tokens = await provider.tokens();
      if (!tokens) {
        throw new Error("Failed to retrieve tokens after authorization");
      }

      const scopeToPersist =
        this.pendingAuthorizationScope ?? tokens.scope;
      if (scopeToPersist) {
        await provider.saveScope(scopeToPersist);
      }
      this.pendingAuthorizationScope = undefined;

      const clientInfo = await provider.clientInformation();
      const completedAt = Date.now();
      this.oauthFlowState = this.oauthFlowState
        ? {
            ...this.oauthFlowState,
            oauthStep: "complete",
            oauthTokens: tokens,
            oauthClientInfo: clientInfo ?? null,
            completedAt,
          }
        : {
            ...EMPTY_OAUTH_FLOW_STATE,
            oauthStep: "complete",
            oauthTokens: tokens,
            oauthClientInfo: clientInfo ?? null,
            completedAt,
          };

      this.params.dispatchOAuthComplete({ tokens });
    } catch (error) {
      this.pendingAuthorizationScope = undefined;
      this.params.dispatchOAuthError({
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  async getOAuthTokens(): Promise<OAuthTokens | undefined> {
    if (this.oauthFlowState?.oauthTokens) {
      return this.oauthFlowState.oauthTokens;
    }

    const provider = await this.createOAuthProvider();
    try {
      return await provider.tokens();
    } catch {
      return undefined;
    }
  }

  clearOAuthTokens(): void {
    if (!this.oauthConfig?.storage) {
      return;
    }

    const serverUrl = this.getServerUrl();
    this.oauthConfig.storage.clear(serverUrl);

    this.oauthFlowState = null;
    this.pendingAuthorizationScope = undefined;
  }

  async isOAuthAuthorized(): Promise<boolean> {
    const tokens = await this.getOAuthTokens();
    return tokens !== undefined;
  }

  getOAuthFlowState(): OAuthFlowState | undefined {
    return this.oauthFlowState ? { ...this.oauthFlowState } : undefined;
  }

  getOAuthFlowStep(): OAuthStep | undefined {
    return this.oauthFlowState?.oauthStep;
  }

  /**
   * Persisted OAuth authorization snapshot for this server (storage + config).
   * Returns undefined when OAuth is not configured for the server.
   */
  async getOAuthState(): Promise<OAuthConnectionState | undefined> {
    const storage = this.oauthConfig.storage;
    if (!storage) {
      return undefined;
    }

    const serverUrl = this.getServerUrl();
    const hasConfiguredOptions = isServerOAuthConfigured(this.oauthConfig);
    if (
      !hasConfiguredOptions &&
      !(await hasPersistedOAuthServerState(storage, serverUrl))
    ) {
      return undefined;
    }

    return buildOAuthConnectionState({
      serverUrl: this.getServerUrl(),
      protocol: protocolFromOAuthConfig(this.oauthConfig),
      configuredScope: this.oauthConfig.scope,
      enterpriseManagedAuth: this.params.enterpriseManagedAuth,
      storage: this.oauthConfig.storage!,
      flowState: this.oauthFlowState ?? undefined,
    });
  }

  /**
   * Re-run EMA legs 2–3 when resource tokens expire but IdP session remains valid.
   */
  async refreshEnterpriseManagedTokens(): Promise<boolean> {
    if (!this.isEnterpriseManaged()) return false;
    const tokens = await refreshEmaResourceTokens(this.getEmaFlowConfig());
    return tokens !== undefined;
  }

  /**
   * Re-read persisted OAuth state and determine whether `challenge` is already
   * satisfied without an authorization-server round-trip.
   *
   * Returns `true` for `insufficient_scope` when stored + token scope cover the
   * SEP-2350 union. For `token_expired` / `unauthorized` / `invalid_token`,
   * returns `true` when a usable access token is already in storage.
   */
  async checkAuthChallengeSatisfied(
    challenge: AuthChallenge,
  ): Promise<boolean> {
    const storage = this.oauthConfig.storage;
    if (!storage) {
      return false;
    }

    const serverUrl = this.getServerUrl();
    const tokens = await storage.getTokens(serverUrl);
    if (!tokens?.access_token) {
      return false;
    }

    if (challenge.reason !== "insufficient_scope") {
      return (
        challenge.reason === "token_expired" ||
        challenge.reason === "unauthorized" ||
        challenge.reason === "invalid_token"
      ) && isAccessTokenUsable(tokens);
    }

    const enriched = await this.enrichChallengeWithAuthorizationScopes(
      challenge,
      tokens.scope,
    );
    const scopeForAuth =
      enriched.authorizationScopes?.join(" ") ??
      enriched.requiredScopes?.join(" ");
    if (!scopeForAuth?.trim()) {
      return false;
    }

    const effectiveScope = computeScopeUnion(
      storage.getScope(serverUrl),
      tokens.scope,
    );
    return !isStrictScopeSuperset(scopeForAuth, effectiveScope);
  }

  /**
   * Satisfy a mid-session auth challenge when possible (silent refresh/re-mint or
   * interactive redirect).
   *
   * Only `insufficient_scope` short-circuits on {@link checkAuthChallengeSatisfied}
   * here — `token_expired` / `unauthorized` still attempt silent refresh even when
   * storage holds a locally-valid token (the resource server may have invalidated it).
   * Callers use {@link checkAuthChallengeSatisfied} directly before visible OAuth.
   *
   * Recovery is serialized per server so parallel challenges cannot race on
   * `pendingAuthorizationScope` or OAuth provider state.
   */
  async handleAuthChallenge(
    challenge: AuthChallenge,
    options?: HandleAuthChallengeOptions,
  ): Promise<AuthChallengeOutcome> {
    if (
      challenge.reason === "insufficient_scope" &&
      (await this.checkAuthChallengeSatisfied(challenge))
    ) {
      return { kind: "satisfied" };
    }

    const prior = this.authChallengeMutex;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.authChallengeMutex = gate;
    await prior;
    try {
      if (
        challenge.reason === "insufficient_scope" &&
        (await this.checkAuthChallengeSatisfied(challenge))
      ) {
        return { kind: "satisfied" };
      }
      return await this.runHandleAuthChallenge(challenge, options);
    } finally {
      release();
    }
  }

  private async runHandleAuthChallenge(
    challenge: AuthChallenge,
    options?: HandleAuthChallengeOptions,
  ): Promise<AuthChallengeOutcome> {
    if (this.isEnterpriseManaged()) {
      return this.handleEnterpriseManagedAuthChallenge(challenge, options);
    }
    return this.handleStandardAuthChallenge(challenge);
  }

  private async enrichChallengeWithAuthorizationScopes(
    challenge: AuthChallenge,
    grantedTokenScope?: string,
  ): Promise<AuthChallenge> {
    if (challenge.reason !== "insufficient_scope") {
      return challenge;
    }

    const storage = this.oauthConfig.storage;
    const serverUrl = this.getServerUrl();

    if (grantedTokenScope === undefined && storage) {
      const tokens = await storage.getTokens(serverUrl);
      grantedTokenScope = tokens?.scope;
    }

    const previousScope = computeScopeUnion(
      storage?.getScope(serverUrl),
      grantedTokenScope,
    );
    const requiredFromChallenge = challenge.requiredScopes?.filter(Boolean) ?? [];
    const grantedSet = new Set(parseScopeString(previousScope));
    const missingRequired = requiredFromChallenge.filter(
      (scope) => !grantedSet.has(scope),
    );
    const requiredScopes =
      missingRequired.length > 0 ? missingRequired : requiredFromChallenge;

    const authorizationScopes = unionAuthorizationScopes(
      previousScope,
      requiredFromChallenge,
    );

    return {
      ...challenge,
      requiredScopes,
      authorizationScopes,
    };
  }

  private resolveEmaScopeForChallenge(challenge: AuthChallenge): string | undefined {
    if (challenge.reason === "insufficient_scope") {
      const fromChallenge = challenge.requiredScopes?.join(" ").trim();
      if (fromChallenge) {
        return fromChallenge;
      }
    }
    return this.oauthConfig.scope?.trim() || undefined;
  }

  private emaFlowConfigForChallenge(challenge: AuthChallenge): EmaFlowConfig {
    const base = this.getEmaFlowConfig();
    const enriched = challenge.authorizationScopes;
    if (enriched && enriched.length > 0) {
      return { ...base, scope: enriched.join(" ") };
    }
    const scope = this.resolveEmaScopeForChallenge(challenge);
    return scope ? { ...base, scope } : base;
  }

  private async handleEnterpriseManagedAuthChallenge(
    challenge: AuthChallenge,
    options?: HandleAuthChallengeOptions,
  ): Promise<AuthChallengeOutcome> {
    const enriched = await this.enrichChallengeWithAuthorizationScopes(challenge);

    if (enriched.reason === "insufficient_scope" && !options?.confirmedStepUp) {
      return { kind: "step_up_confirm", challenge: enriched };
    }

    const config = this.emaFlowConfigForChallenge(enriched);

    if (enriched.reason === "insufficient_scope") {
      const silent = await trySilentEmaAuth(config);
      if (silent.status === "success") {
        if (enriched.authorizationScopes?.length) {
          await this.oauthConfig.storage!.saveScope(
            this.getServerUrl(),
            enriched.authorizationScopes.join(" "),
          );
        }
        if (await this.checkAuthChallengeSatisfied(enriched)) {
          return { kind: "satisfied" };
        }
      }
      if (silent.status === "mint_failed") {
        return { kind: "failed", error: silent.error };
      }
    } else {
      const tokens = await refreshEmaResourceTokens(config);
      if (tokens) {
        return { kind: "satisfied" };
      }
    }

    try {
      const authorizationUrl = await startEmaIdpAuthorization(config);
      if (
        enriched.reason === "insufficient_scope" &&
        enriched.authorizationScopes?.length
      ) {
        this.pendingAuthorizationScope =
          enriched.authorizationScopes.join(" ");
      }
      return { kind: "interactive", authorizationUrl, challenge: enriched };
    } catch (error) {
      return {
        kind: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  private async handleStandardAuthChallenge(
    challenge: AuthChallenge,
  ): Promise<AuthChallengeOutcome> {
    const provider = await this.createOAuthProvider();
    const serverUrl = this.getServerUrl();
    const tokens = await provider.tokens();
    const enriched = await this.enrichChallengeWithAuthorizationScopes(
      challenge,
      tokens?.scope,
    );

    provider.clearCapturedAuthUrl();

    await ensureCimdClientRegistration({
      serverUrl,
      provider,
      fetchFn: this.params.effectiveAuthFetch,
    });

    const scopeForAuth =
      enriched.reason === "insufficient_scope"
        ? enriched.authorizationScopes?.join(" ")
        : this.oauthConfig.scope?.trim() ||
          (enriched.requiredScopes?.length
            ? enriched.requiredScopes.join(" ")
            : undefined);

    provider.setSuppressAuthorizationNavigation(true);
    let result: Awaited<ReturnType<typeof mcpAuth>>;
    try {
      result = await mcpAuth(provider, {
        serverUrl,
        scope: scopeForAuth,
        fetchFn: this.params.effectiveAuthFetch,
        ...(enriched.reason === "insufficient_scope" && {
          forceReauthorization: isStrictScopeSuperset(
            scopeForAuth,
            tokens?.scope,
          ),
        }),
      });
    } finally {
      provider.setSuppressAuthorizationNavigation(false);
    }

    if (result === "AUTHORIZED") {
      if (enriched.reason === "insufficient_scope") {
        if (await this.checkAuthChallengeSatisfied(enriched)) {
          if (scopeForAuth) {
            await provider.saveScope(scopeForAuth);
          }
          return { kind: "satisfied" };
        }
        const forced = await this.tryForceReauthorizationForStepUp(
          provider,
          serverUrl,
          scopeForAuth,
          enriched,
        );
        if (forced) {
          return forced;
        }
        return {
          kind: "failed",
          error: new Error(stepUpInsufficientScopeMessage(enriched)),
        };
      } else {
        return { kind: "satisfied" };
      }
    }

    const capturedUrl = provider.getCapturedAuthUrl();
    if (!capturedUrl) {
      return {
        kind: "failed",
        error: new Error("Failed to capture authorization URL"),
      };
    }

    if (enriched.reason === "insufficient_scope" && scopeForAuth) {
      this.pendingAuthorizationScope = scopeForAuth;
    }

    const clientInfo = await provider.clientInformation();
    await this.recordAuthorizationCodeFlowState(capturedUrl, clientInfo);

    return {
      kind: "interactive",
      authorizationUrl: capturedUrl,
      challenge: enriched,
    };
  }

  /** Start interactive OAuth after handleAuthChallenge returns `interactive`. */
  async beginInteractiveAuthorization(authorizationUrl: URL): Promise<void> {
    const stateParam = authorizationUrl.searchParams.get("state");
    if (stateParam && this.params.onBeforeOAuthRedirect) {
      const parsedState = parseOAuthState(stateParam);
      if (parsedState?.authId) {
        await this.params.onBeforeOAuthRedirect(parsedState.authId);
      }
    }

    this.requireNavigation().navigateToAuthorization(authorizationUrl);

    const provider = await this.createOAuthProvider();
    const clientInfo = await provider.clientInformation();
    await this.recordAuthorizationCodeFlowState(authorizationUrl, clientInfo);

    this.params.dispatchOAuthAuthorizationRequired({ url: authorizationUrl });
  }

  private requireNavigation(): NonNullable<OAuthManagerConfig["navigation"]> {
    const navigation = this.oauthConfig.navigation;
    if (!navigation) {
      throw new Error("OAuth navigation is required.");
    }
    return navigation;
  }

  private async recordAuthorizationCodeFlowState(
    authorizationUrl: URL,
    oauthClientInfo?: OAuthClientInformation | null,
  ): Promise<void> {
    this.oauthFlowState = {
      ...EMPTY_OAUTH_FLOW_STATE,
      oauthStep: "authorization_code",
      authorizationUrl,
      oauthClientInfo: oauthClientInfo ?? null,
    };
  }

  /**
   * Silent refresh returned AUTHORIZED but token scope still lacks the step-up
   * union — force a fresh authorization redirect.
   */
  private async tryForceReauthorizationForStepUp(
    provider: BaseOAuthClientProvider,
    serverUrl: string,
    scopeForAuth: string | undefined,
    enriched: AuthChallenge,
  ): Promise<AuthChallengeOutcome | null> {
    provider.clearCapturedAuthUrl();
    provider.setSuppressAuthorizationNavigation(true);
    let result: Awaited<ReturnType<typeof mcpAuth>>;
    try {
      result = await mcpAuth(provider, {
        serverUrl,
        scope: scopeForAuth,
        fetchFn: this.params.effectiveAuthFetch,
        forceReauthorization: true,
      });
    } finally {
      provider.setSuppressAuthorizationNavigation(false);
    }
    if (result !== "AUTHORIZED") {
      return null;
    }
    if (await this.checkAuthChallengeSatisfied(enriched)) {
      if (scopeForAuth) {
        await provider.saveScope(scopeForAuth);
      }
      return { kind: "satisfied" };
    }
    return null;
  }

  /**
   * Create an OAuth provider for transport auth (connect()).
   * Used only when isHttpOAuthConfig() is true.
   */
  async createOAuthProviderForTransport(): Promise<
    BaseOAuthClientProvider | EmaTransportOAuthProvider
  > {
    const provider = await this.createOAuthProvider();
    if (this.isEnterpriseManaged()) {
      return new EmaTransportOAuthProvider(provider, this.getEmaFlowConfig());
    }
    return provider;
  }
}
