/**
 * Internal OAuth sub-manager for InspectorClient.
 * Holds OAuth config, state machine, and guided state; orchestrates quick and guided flows.
 * Not part of the public API; InspectorClient delegates to this module.
 */

import { BaseOAuthClientProvider } from "../auth/providers.js";
import type { AuthExecution, OAuthFlowState, OAuthStep } from "../auth/types.js";
import { EMPTY_OAUTH_FLOW_STATE } from "../auth/types.js";
import { OAuthStateMachine } from "../auth/state-machine.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformation } from "@modelcontextprotocol/sdk/shared/auth.js";
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
  isServerOAuthConfigured,
  protocolFromOAuthConfig,
} from "../auth/connection-state.js";
import { ensureCimdClientRegistration } from "../auth/cimd.js";
import type { OAuthConnectionState } from "../auth/types.js";
import { EmaTransportOAuthProvider } from "../auth/ema/transportProvider.js";
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
  dispatchOAuthStepChange: (detail: {
    step: OAuthStep;
    previousStep: OAuthStep;
    state: Partial<OAuthFlowState>;
  }) => void;
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
  private oauthStateMachine: OAuthStateMachine | null = null;
  private oauthFlowState: OAuthFlowState | null = null;

  constructor(params: OAuthManagerParams) {
    this.params = params;
    this.oauthConfig = { ...params.initialConfig };
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

  private async createOAuthProvider(
    execution: AuthExecution,
  ): Promise<BaseOAuthClientProvider> {
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
    const provider = new BaseOAuthClientProvider(
      serverUrl,
      {
        storage: this.oauthConfig.storage,
        redirectUrlProvider: this.oauthConfig.redirectUrlProvider,
        navigation: this.oauthConfig.navigation,
        clientMetadataUrl: this.oauthConfig.clientMetadataUrl,
      },
      execution,
    );

    provider.setEventTarget(this.params.getEventTarget());

    if (this.oauthConfig.scope) {
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
      scope: this.oauthConfig.scope,
      redirectUrl: this.oauthConfig.redirectUrlProvider.getRedirectUrl("quick"),
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

    this.oauthConfig.navigation!.navigateToAuthorization(authorizationUrl);
    this.oauthFlowState = {
      ...EMPTY_OAUTH_FLOW_STATE,
      execution: "quick",
      oauthStep: "authorization_code",
      authorizationUrl,
    };
    return authorizationUrl;
  }

  async authenticate(): Promise<URL | undefined> {
    if (this.isEnterpriseManaged()) {
      return this.authenticateEnterpriseManaged();
    }

    const provider = await this.createOAuthProvider("quick");
    const serverUrl = this.getServerUrl();

    provider.clearCapturedAuthUrl();

    await ensureCimdClientRegistration({
      serverUrl,
      provider,
      fetchFn: this.params.effectiveAuthFetch,
    });

    const result = await auth(provider, {
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
      execution: "quick",
      oauthStep: "authorization_code",
      authorizationUrl: capturedUrl,
      oauthClientInfo: clientInfo ?? null,
    };
    return capturedUrl;
  }

  async beginGuidedAuth(): Promise<void> {
    const provider = await this.createOAuthProvider("guided");
    const serverUrl = this.getServerUrl();

    this.oauthFlowState = { ...EMPTY_OAUTH_FLOW_STATE };
    if (this.oauthConfig.clientId) {
      this.oauthFlowState.oauthClientInfo = {
        client_id: this.oauthConfig.clientId,
        ...(this.oauthConfig.clientSecret && {
          client_secret: this.oauthConfig.clientSecret,
        }),
      };
    }
    this.oauthStateMachine = new OAuthStateMachine(
      serverUrl,
      provider,
      (updates) => {
        const state = this.oauthFlowState;
        if (!state) throw new Error("OAuth state not initialized");
        const previousStep = state.oauthStep;
        this.oauthFlowState = { ...state, ...updates };
        if (updates.oauthStep === "complete") {
          this.oauthFlowState!.completedAt = Date.now();
        }
        const step = updates.oauthStep ?? previousStep;
        this.params.dispatchOAuthStepChange({
          step,
          previousStep,
          state: updates,
        });
      },
      this.params.effectiveAuthFetch,
    );

    await this.oauthStateMachine.executeStep(this.oauthFlowState);
  }

  async runGuidedAuth(): Promise<URL | undefined> {
    if (!this.oauthStateMachine || !this.oauthFlowState) {
      await this.beginGuidedAuth();
    }

    const machine = this.oauthStateMachine;
    if (!machine) {
      throw new Error("Guided auth failed to initialize state");
    }

    while (true) {
      const state = this.oauthFlowState;
      if (!state) {
        throw new Error("Guided auth failed to initialize state");
      }
      if (
        state.oauthStep === "authorization_code" ||
        state.oauthStep === "complete"
      ) {
        break;
      }
      await machine.executeStep(state);
    }

    const state = this.oauthFlowState;
    if (state?.oauthStep === "complete") {
      return undefined;
    }
    if (!state?.authorizationUrl) {
      throw new Error("Failed to generate authorization URL");
    }

    const stateParam = state.authorizationUrl.searchParams.get("state");
    if (stateParam && this.params.onBeforeOAuthRedirect) {
      const parsedState = parseOAuthState(stateParam);
      if (parsedState?.authId) {
        await this.params.onBeforeOAuthRedirect(parsedState.authId);
      }
    }

    this.params.dispatchOAuthAuthorizationRequired({
      url: state.authorizationUrl,
    });

    return state.authorizationUrl;
  }

  async setGuidedAuthorizationCode(
    authorizationCode: string,
    completeFlow: boolean = false,
  ): Promise<void> {
    if (!this.oauthStateMachine || !this.oauthFlowState) {
      throw new Error(
        "Not in guided OAuth flow. Call beginGuidedAuth() first.",
      );
    }
    const currentStep = this.oauthFlowState.oauthStep;
    if (currentStep !== "authorization_code") {
      throw new Error(
        `Cannot set authorization code at step ${currentStep}. Expected step: authorization_code`,
      );
    }

    this.oauthFlowState.authorizationCode = authorizationCode;

    if (completeFlow) {
      await this.oauthStateMachine.executeStep(this.oauthFlowState);
      let step: OAuthStep = this.oauthFlowState.oauthStep;
      while (step !== "complete") {
        await this.oauthStateMachine.executeStep(this.oauthFlowState);
        step = this.oauthFlowState.oauthStep;
      }

      if (!this.oauthFlowState.oauthTokens) {
        throw new Error("Failed to exchange authorization code for tokens");
      }

      this.params.dispatchOAuthComplete({
        tokens: this.oauthFlowState.oauthTokens,
      });
    } else {
      this.params.dispatchOAuthStepChange({
        step: this.oauthFlowState.oauthStep,
        previousStep: this.oauthFlowState.oauthStep,
        state: { authorizationCode },
      });
    }
  }

  async completeOAuthFlow(authorizationCode: string): Promise<void> {
    try {
      if (this.isEnterpriseManaged()) {
        const config = this.getEmaFlowConfig();
        const tokens = await completeEmaIdpAuthorizationAndMint(
          config,
          authorizationCode,
        );
        const completedAt = Date.now();
        this.oauthFlowState = {
          ...EMPTY_OAUTH_FLOW_STATE,
          execution: "quick",
          oauthStep: "complete",
          oauthTokens: tokens,
          completedAt,
        };
        this.params.dispatchOAuthComplete({ tokens });
        return;
      }

      if (this.oauthStateMachine && this.oauthFlowState) {
        await this.setGuidedAuthorizationCode(authorizationCode, true);
      } else {
        const provider = await this.createOAuthProvider("quick");
        const serverUrl = this.getServerUrl();

        const result = await auth(provider, {
          serverUrl,
          authorizationCode,
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
              execution: "quick",
              oauthStep: "complete",
              oauthTokens: tokens,
              oauthClientInfo: clientInfo ?? null,
              completedAt,
            };

        this.params.dispatchOAuthComplete({ tokens });
      }
    } catch (error) {
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

    const provider = await this.createOAuthProvider("quick");
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
    this.oauthStateMachine = null;
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
    if (!isServerOAuthConfigured(this.oauthConfig)) {
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

  async proceedOAuthStep(): Promise<void> {
    if (!this.oauthStateMachine || !this.oauthFlowState) {
      throw new Error(
        "Not in guided OAuth flow. Call authenticateGuided() first.",
      );
    }

    await this.oauthStateMachine.executeStep(this.oauthFlowState);
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
   * Create an OAuth provider for transport auth (connect()).
   * Used only when isHttpOAuthConfig() is true.
   */
  async createOAuthProviderForTransport(): Promise<
    BaseOAuthClientProvider | EmaTransportOAuthProvider
  > {
    const provider = await this.createOAuthProvider("quick");
    if (this.isEnterpriseManaged()) {
      return new EmaTransportOAuthProvider(provider, this.getEmaFlowConfig());
    }
    return provider;
  }
}
