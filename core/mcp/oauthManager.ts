/**
 * Internal OAuth sub-manager for InspectorClient.
 * Holds OAuth config and in-memory flow state; orchestrates authenticate() / completeOAuthFlow().
 * Not part of the public API; InspectorClient delegates to this module.
 */

import { BaseOAuthClientProvider } from "../auth/providers.js";
import type { OAuthEndpointOverrides } from "../auth/endpointOverrides.js";
import type { OAuthFlowState, OAuthStep } from "../auth/types.js";
import { EMPTY_OAUTH_FLOW_STATE } from "../auth/types.js";
import type { OAuthTokens } from "@modelcontextprotocol/client";
import type { OAuthClientInformation } from "@modelcontextprotocol/client";
import { mcpAuth } from "../auth/mcpAuth.js";
import type { OAuthStorage } from "../auth/storage.js";
import { parseOAuthState } from "../auth/utils.js";
import {
  clearAndPlanRevocation,
  executeOAuthRevocation,
  type TokenRevocationOutcome,
} from "../auth/revocation.js";
import type { InspectorLogger } from "../logging/index.js";
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
  isAccessTokenProvablyUnexpired,
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
  challengeResourceMetadataUrl,
  parseScopeString,
  unionAuthorizationScopes,
} from "../auth/challenge.js";
import {
  computeScopeUnion,
  isStrictScopeSuperset,
  resolveEffectiveGrantedScope,
  resolvePersistedScopeAfterGrant,
  scopeForDeclinedRefreshGrant,
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
  /** Used for the best-effort RFC 7009 revocation warning (#2144). */
  logger?: InspectorLogger;
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

  /**
   * The RFC 9728 metadata URL from the last 401/403 the transport observed.
   * See {@link noteObservedAuthChallenge}.
   */
  private observedResourceMetadataUrl: URL | undefined;
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
    authorizationParams?: Record<string, string>;
    authorizationUrl?: string;
    tokenUrl?: string;
    /** Declare the `refresh_token` grant in client metadata (#2068). */
    requestRefreshToken?: boolean;
  }): void {
    this.oauthConfig = {
      ...this.oauthConfig,
      ...config,
    } as OAuthManagerConfig;
  }

  private getServerUrl(): string {
    return this.params.getServerUrl();
  }

  /**
   * The per-server authorization/token endpoint overrides, read live so a
   * `setOAuthConfig` between requests takes effect without rebuilding the
   * client's fetch. `InspectorClient` reads this from inside its fetch wrapper.
   * (#1906)
   *
   * Returns nothing under enterprise-managed authorization, for the same reason
   * `redirectToExternalAuthorization` skips the custom authorization parameters
   * (#2018): the EMA leg authorizes against the enterprise IdP, a *different*
   * authorization server, and its OIDC discovery runs through this same fetch
   * (`emaFlow` → `idpOidc`). Rewriting that document would point the IdP login —
   * or the IdP code/refresh-token exchange — at the resource server's
   * authorization server, which is both wrong and a way to leak an IdP
   * credential across an authorization-server boundary.
   */
  getEndpointOverrides(): OAuthEndpointOverrides | undefined {
    if (this.isEnterpriseManaged()) return undefined;
    const { authorizationUrl, tokenUrl } = this.oauthConfig;
    if (!authorizationUrl && !tokenUrl) return undefined;
    return {
      ...(authorizationUrl && { authorizationUrl }),
      ...(tokenUrl && { tokenUrl }),
    };
  }

  /**
   * Return the configured OAuth storage, throwing a clear error if it is
   * absent. Used on the EMA re-mint/persist paths, which are only reached for
   * a fully-configured OAuth-capable server (storage present).
   */
  private requireStorage(): OAuthStorage {
    const storage = this.oauthConfig.storage;
    if (!storage) {
      throw new Error("OAuth storage is required for this operation.");
    }
    return storage;
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
      // #2018: per-server custom authorization-request parameters. Carried on
      // the provider (not in OAuth storage like `scope`) — they are pure config
      // read from mcp.json, and nothing in the flow needs to persist or union
      // them.
      authorizationParams: this.oauthConfig.authorizationParams,
      // #2068: per-server opt-out of the `refresh_token` grant. Like
      // `authorizationParams` this is pure config off mcp.json, so it lives on
      // the provider rather than in OAuth storage.
      requestRefreshToken: this.oauthConfig.requestRefreshToken,
      // #2068: lets the provider tell an `offline_access` the user asked for
      // from one inherited from a previous grant's persisted scope.
      configuredScope: this.oauthConfig.scope,
    });

    provider.setEventTarget(this.params.getEventTarget());

    await provider.prepareForAuth();
    const storedScope = provider.scope;
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

  private async getEmaFlowConfig(): Promise<EmaFlowConfig> {
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
    const storedScope = await this.oauthConfig.storage.getScope(
      this.getServerUrl(),
    );
    return {
      serverUrl: this.getServerUrl(),
      idp,
      resourceClientId: this.oauthConfig.clientId,
      resourceClientSecret: this.oauthConfig.clientSecret,
      scope:
        computeScopeUnion(this.oauthConfig.scope, storedScope) ||
        this.oauthConfig.scope,
      redirectUrl: this.oauthConfig.redirectUrlProvider.getRedirectUrl(),
      storage: this.oauthConfig.storage,
      fetchFn: this.params.effectiveAuthFetch,
    };
  }

  /** Attempt silent EMA (cached IdP session + legs 2–3). */
  async trySilentEnterpriseManagedAuth(): Promise<boolean> {
    if (!this.isEnterpriseManaged()) return false;
    const result = await trySilentEmaAuth(await this.getEmaFlowConfig());
    if (result.status === "success") return true;
    if (result.status === "mint_failed") throw result.error;
    return false;
  }

  private async authenticateEnterpriseManaged(): Promise<URL | undefined> {
    const config = await this.getEmaFlowConfig();
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

  /**
   * Record a challenge the transport saw but did not raise as one.
   *
   * The legacy first-authorization path connects with no `authProvider` and no
   * challenge interception, so the client calls {@link authenticate} off a
   * headerless SDK `UnauthorizedError` — this is what carries the advertised
   * RFC 9728 metadata URL across that gap (#2071). Latest-wins: every
   * challenge comes from the same server, so the most recent one is what that
   * server currently says, including when it says nothing.
   */
  noteObservedAuthChallenge(challenge: AuthChallenge): void {
    this.observedResourceMetadataUrl = challengeResourceMetadataUrl(challenge);
  }

  async authenticate(): Promise<URL | undefined> {
    if (this.isEnterpriseManaged()) {
      return this.authenticateEnterpriseManaged();
    }

    const provider = await this.createOAuthProvider();
    const serverUrl = this.getServerUrl();

    provider.clearCapturedAuthUrl();

    // No challenge is passed to this entry point — it is reached from a plain
    // unauthorized error — so the last one the transport observed is the only
    // source for the advertised metadata URL.
    const resourceMetadataUrl = this.observedResourceMetadataUrl;

    await ensureCimdClientRegistration({
      serverUrl,
      provider,
      fetchFn: this.params.effectiveAuthFetch,
      resourceMetadataUrl,
    });

    // Read once: the getter filters (#2068), so this is what was actually
    // requested and what the callback leg has to persist.
    const requestedScope = provider.scope;
    const result = await mcpAuth(provider, {
      serverUrl,
      scope: requestedScope,
      fetchFn: this.params.effectiveAuthFetch,
      resourceMetadataUrl,
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

    this.recordAuthorizationRequestScope(capturedUrl, requestedScope);

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

  /**
   * Remember what an interactive authorization asked for, so the callback can
   * apply RFC 6749 §5.1 — a token response that omits `scope` granted exactly
   * the requested scope (#2117). Without it, an ordinary grant whose AS echoes
   * no scope leaves the previous stored scope standing as though it were what
   * the current token carries.
   *
   * The authorize URL is the authority, not the scope handed to `auth()`: the
   * SDK augments the request with `offline_access` when the AS advertises it
   * and the client asks for a refresh token, so the input can be a strict
   * subset of what was actually requested. The fallback covers an authorize
   * URL that carries no `scope` parameter at all.
   *
   * This composes with the #2068 refresh-token opt-out rather than defeating
   * it. The SDK's augmentation is gated on `clientMetadata.grant_types`
   * including `refresh_token`, which the provider drops when the opt-out is
   * on — so with the grant declined the URL carries the *filtered* scope, and
   * that is what gets persisted. #2068 recorded the same value here behind a
   * `requestRefreshToken === false` gate; reading the URL makes the gate
   * unnecessary, so one wire case now has one persistence behavior instead of
   * two selected by a checkbox (#2117).
   */
  private recordAuthorizationRequestScope(
    authorizationUrl: URL,
    requestedScope: string | undefined,
  ): void {
    this.pendingAuthorizationScope =
      authorizationUrl.searchParams.get("scope")?.trim() || requestedScope;
  }

  async completeOAuthFlow(
    authorizationCode: string,
    iss?: string,
  ): Promise<void> {
    try {
      if (this.isEnterpriseManaged()) {
        const emaConfig = await this.getEmaFlowConfig();
        const scopeForMint = this.pendingAuthorizationScope ?? emaConfig.scope;
        const config = scopeForMint
          ? { ...emaConfig, scope: scopeForMint }
          : emaConfig;
        // The EMA flow persists the granted scope alongside the tokens, for
        // every mint rather than only this one — see saveMintedTokens.
        const { tokens } = await completeEmaIdpAuthorizationAndMint(
          config,
          authorizationCode,
          iss,
        );
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

      const requestedScope = this.pendingAuthorizationScope;
      const scopeToPersist = resolvePersistedScopeAfterGrant(
        tokens.scope,
        requestedScope,
      );
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

  /**
   * Drop this server's local OAuth state, and revoke the grant at the
   * authorization server (RFC 7009).
   *
   * The state is taken and deleted in one atomic step, and the requests are
   * sent afterwards from what was taken. Both halves matter: the requests need
   * state the clear destroys, and the clear must not wait on the network, or a
   * fresh authorization completing during a five-second revocation would be
   * deleted by a clear reasoning about the grant it replaced.
   *
   * Best-effort by construction: every failure is reported through the returned
   * outcome and the clear has already happened regardless, because forgetting
   * the tokens is what the caller actually asked for (#2144).
   *
   * `options.revoke === false` skips the request. That is not only an escape
   * hatch for an authorization server that mishandles it — disconnecting while
   * still holding live tokens is a case a user may want to reproduce
   * deliberately, to watch how a server under test copes with it.
   */
  async clearOAuthTokens(options?: {
    revoke?: boolean;
  }): Promise<TokenRevocationOutcome> {
    if (!this.oauthConfig?.storage) {
      return { status: "skipped", reason: "no_tokens" };
    }

    const serverUrl = this.getServerUrl();
    // Takes the state and deletes it in ONE atomic storage step; separate
    // reads followed by a separate clear are a check-then-act, and an OAuth
    // completion landing between them would be destroyed by the clear.
    const plan = await clearAndPlanRevocation({
      serverUrl,
      storage: this.oauthConfig.storage,
      enabled: options?.revoke,
    });

    this.oauthFlowState = null;
    this.pendingAuthorizationScope = undefined;
    return executeOAuthRevocation(plan, {
      fetchFn: this.params.effectiveAuthFetch,
      logger: this.params.logger,
    });
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
      storage,
      flowState: this.oauthFlowState ?? undefined,
    });
  }

  /**
   * Re-run EMA legs 2–3 when resource tokens expire but IdP session remains valid.
   */
  async refreshEnterpriseManagedTokens(): Promise<boolean> {
    if (!this.isEnterpriseManaged()) return false;
    const tokens = await refreshEmaResourceTokens(
      await this.getEmaFlowConfig(),
    );
    return tokens !== undefined;
  }

  /**
   * Re-read persisted OAuth state and determine whether `challenge` is already
   * satisfied without an authorization-server round-trip.
   *
   * Returns `true` for `insufficient_scope` when stored + token scope cover the
   * SEP-2350 union. For `token_expired`, returns `true` only when storage holds
   * a *provably* unexpired token — a JWT whose `exp` is still in the future. An
   * opaque token carries no local expiry evidence, so the resource server's
   * verdict stands and re-authorization proceeds. `invalid_token` and
   * `unauthorized` always return `false` — the resource server explicitly
   * rejected the credential.
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
        challenge.reason === "token_expired" &&
        isAccessTokenProvablyUnexpired(tokens)
      );
    }

    const enriched = await this.enrichChallengeWithAuthorizationScopes(
      challenge,
      tokens.scope,
    );
    const authorizationScopesJoined = enriched.authorizationScopes?.join(" ");
    /* v8 ignore next -- authorizationScopes from enrichChallengeWithAuthorizationScopes is always a defined array here, so this fallback is unreachable */
    const scopeForAuth =
      authorizationScopesJoined ?? enriched.requiredScopes?.join(" ");
    if (!scopeForAuth?.trim()) {
      return false;
    }

    const effectiveScope = resolveEffectiveGrantedScope(
      await storage.getScope(serverUrl),
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
      storage ? await storage.getScope(serverUrl) : undefined,
      grantedTokenScope,
    );
    const requiredFromChallenge =
      challenge.requiredScopes?.filter(Boolean) ?? [];
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

  private resolveEmaScopeForChallenge(
    challenge: AuthChallenge,
  ): string | undefined {
    if (challenge.reason === "insufficient_scope") {
      const fromChallenge = challenge.requiredScopes?.join(" ").trim();
      /* v8 ignore next 3 -- authorizationScopes is empty only when requiredScopes is also empty, so this branch is unreachable */
      if (fromChallenge) {
        return fromChallenge;
      }
    }
    return this.oauthConfig.scope?.trim() || undefined;
  }

  private async emaFlowConfigForChallenge(
    challenge: AuthChallenge,
  ): Promise<EmaFlowConfig> {
    const base = await this.getEmaFlowConfig();
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
    const enriched =
      await this.enrichChallengeWithAuthorizationScopes(challenge);

    if (enriched.reason === "insufficient_scope" && !options?.confirmedStepUp) {
      return { kind: "step_up_confirm", challenge: enriched };
    }

    const config = await this.emaFlowConfigForChallenge(enriched);

    if (enriched.reason === "insufficient_scope") {
      const silent = await trySilentEmaAuth(config);
      if (silent.status === "success") {
        if (await this.checkAuthChallengeSatisfied(enriched)) {
          const minted = await this.requireStorage().getTokens(
            this.getServerUrl(),
          );
          const scopeToPersist = resolvePersistedScopeAfterGrant(
            minted?.scope,
            enriched.authorizationScopes?.join(" "),
          );
          if (scopeToPersist) {
            await this.requireStorage().saveScope(
              this.getServerUrl(),
              scopeToPersist,
            );
          }
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
        this.pendingAuthorizationScope = enriched.authorizationScopes.join(" ");
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

    // RFC 9728: honor the metadata document the challenge advertised rather
    // than probing the default locations derived from the MCP server URL
    // (#2071). The SDK persists it in its discovery state, so the callback leg
    // recovers it without our passing it again.
    const resourceMetadataUrl = challengeResourceMetadataUrl(enriched);

    await ensureCimdClientRegistration({
      serverUrl,
      provider,
      fetchFn: this.params.effectiveAuthFetch,
      resourceMetadataUrl,
    });

    // #2068 — the step-up union is built from *raw* storage
    // (`enrichChallengeWithScopes`) and handed to the SDK directly, so it never
    // passes through the provider's filtering `scope` getter. Without this an
    // `offline_access` inherited from an earlier grant reappears here and the
    // SDK re-adds `prompt=consent` even with the setting off — the same failure
    // the option exists to prevent, on the one path that bypasses it. A scope
    // the challenge itself requires is preserved, since stripping that would
    // just re-earn the same challenge.
    const requestedScopeForAuth =
      enriched.reason === "insufficient_scope"
        ? enriched.authorizationScopes?.join(" ")
        : this.oauthConfig.scope?.trim() ||
          (enriched.requiredScopes?.length
            ? enriched.requiredScopes.join(" ")
            : undefined);
    const scopeForAuth =
      this.oauthConfig.requestRefreshToken === false
        ? scopeForDeclinedRefreshGrant(
            requestedScopeForAuth,
            this.oauthConfig.scope,
            // The RAW challenge scopes, not `enriched.requiredScopes`:
            // `enrichChallengeWithScopes` narrows that to the *missing* subset,
            // so a challenge requiring `offline_access tools:write` against a
            // stored scope that already has `offline_access` arrives here as
            // just `["tools:write"]`. Passing the narrowed list would read the
            // server's explicit requirement as inherited and strip it — then
            // re-authorization earns the same challenge forever, which is the
            // loop this argument exists to prevent.
            challenge.requiredScopes,
          )
        : requestedScopeForAuth;

    provider.setSuppressAuthorizationNavigation(true);
    let result: Awaited<ReturnType<typeof mcpAuth>>;
    try {
      result = await mcpAuth(provider, {
        serverUrl,
        scope: scopeForAuth,
        fetchFn: this.params.effectiveAuthFetch,
        resourceMetadataUrl,
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
          const freshTokens = await provider.tokens();
          const scopeToPersist = resolvePersistedScopeAfterGrant(
            freshTokens?.scope,
            scopeForAuth,
          );
          if (scopeToPersist) {
            await provider.saveScope(scopeToPersist);
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

    // Every interactive redirect from here lands back in completeOAuthFlow,
    // so every one of them needs its request recorded — not just the step-up
    // (#2117). A plain `unauthorized` / `token_expired` challenge can request
    // a scope that differs from what storage holds, and used to persist
    // nothing when the AS answered without a `scope`.
    this.recordAuthorizationRequestScope(capturedUrl, scopeForAuth);

    const clientInfo = await provider.clientInformation();
    await this.recordAuthorizationCodeFlowState(
      capturedUrl,
      clientInfo,
      // SEP-2350: label a step-up redirect distinctly from a first-time login.
      enriched.reason === "insufficient_scope"
        ? "scope_step_up"
        : "authorization_code",
    );

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

    // Every fallible step runs BEFORE the navigation, deliberately (#2165).
    // `navigateToAuthorization` hands the browser to the authorization server,
    // and a caller that treats a rejection as "the flow never started" — the
    // web client drops its OAuth resume snapshot on one — has no way to tell a
    // pre-navigation failure from a post-navigation one. Resolving the
    // navigation last makes every rejection this method can produce a
    // pre-navigation rejection, so that reading is always correct.
    //
    // It is also the better behaviour on its own terms: a provider that cannot
    // be built, or client information that cannot be read, means the callback
    // could not have been completed anyway, so sending the user to the
    // authorization server first only buys them a round trip to a dead end.
    const navigation = this.requireNavigation();
    const provider = await this.createOAuthProvider();
    const clientInfo = await provider.clientInformation();
    await this.recordAuthorizationCodeFlowState(authorizationUrl, clientInfo);

    navigation.navigateToAuthorization(authorizationUrl);

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
    step: OAuthStep = "authorization_code",
  ): Promise<void> {
    this.oauthFlowState = {
      ...EMPTY_OAUTH_FLOW_STATE,
      oauthStep: step,
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
        resourceMetadataUrl: challengeResourceMetadataUrl(enriched),
        forceReauthorization: true,
      });
    } finally {
      provider.setSuppressAuthorizationNavigation(false);
    }
    if (result !== "AUTHORIZED") {
      return null;
    }
    if (await this.checkAuthChallengeSatisfied(enriched)) {
      const freshTokens = await provider.tokens();
      const scopeToPersist = resolvePersistedScopeAfterGrant(
        freshTokens?.scope,
        scopeForAuth,
      );
      if (scopeToPersist) {
        await provider.saveScope(scopeToPersist);
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
      return new EmaTransportOAuthProvider(
        provider,
        await this.getEmaFlowConfig(),
      );
    }
    return provider;
  }
}
