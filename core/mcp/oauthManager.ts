/**
 * Internal OAuth sub-manager for InspectorClient.
 * Holds OAuth config, state machine, and guided state; orchestrates normal and guided flows.
 * Not part of the public API; InspectorClient delegates to this module.
 */

import { BaseOAuthClientProvider } from "../auth/providers.js";
import type { AuthGuidedState, OAuthStep } from "../auth/types.js";
import { EMPTY_GUIDED_STATE } from "../auth/types.js";
import { OAuthStateMachine } from "../auth/state-machine.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformation } from "@modelcontextprotocol/sdk/shared/auth.js";
import { parseOAuthState } from "../auth/utils.js";
import type {
  InspectorClientOptions,
  InspectorClientEnvironment,
} from "./types.js";

export type OAuthManagerConfig = NonNullable<InspectorClientOptions["oauth"]> &
  NonNullable<InspectorClientEnvironment["oauth"]>;

export interface OAuthManagerParams {
  getServerUrl: () => string;
  effectiveAuthFetch: typeof fetch;
  getEventTarget: () => EventTarget;
  onBeforeOAuthRedirect?: (sessionId: string) => Promise<void>;
  initialConfig: OAuthManagerConfig;
  dispatchOAuthStepChange: (detail: {
    step: OAuthStep;
    previousStep: OAuthStep;
    state: Partial<AuthGuidedState>;
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
  private oauthConfig: OAuthManagerConfig;
  private oauthStateMachine: OAuthStateMachine | null = null;
  private oauthState: AuthGuidedState | null = null;

  constructor(private params: OAuthManagerParams) {
    this.oauthConfig = { ...params.initialConfig };
  }

  setOAuthConfig(config: {
    clientId?: string;
    clientSecret?: string;
    clientMetadataUrl?: string;
    scope?: string;
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
    mode: "normal" | "guided",
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
      mode,
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

  async authenticate(): Promise<URL> {
    const provider = await this.createOAuthProvider("normal");
    const serverUrl = this.getServerUrl();

    provider.clearCapturedAuthUrl();

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
    this.oauthState = {
      ...EMPTY_GUIDED_STATE,
      authType: "normal",
      oauthStep: "authorization_code",
      authorizationUrl: capturedUrl,
      oauthClientInfo: clientInfo ?? null,
    };
    return capturedUrl;
  }

  async beginGuidedAuth(): Promise<void> {
    const provider = await this.createOAuthProvider("guided");
    const serverUrl = this.getServerUrl();

    this.oauthState = { ...EMPTY_GUIDED_STATE };
    if (this.oauthConfig.clientId) {
      this.oauthState.oauthClientInfo = {
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
        const state = this.oauthState;
        if (!state) throw new Error("OAuth state not initialized");
        const previousStep = state.oauthStep;
        this.oauthState = { ...state, ...updates };
        if (updates.oauthStep === "complete") {
          this.oauthState!.completedAt = Date.now();
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

    await this.oauthStateMachine.executeStep(this.oauthState);
  }

  async runGuidedAuth(): Promise<URL | undefined> {
    if (!this.oauthStateMachine || !this.oauthState) {
      await this.beginGuidedAuth();
    }

    const machine = this.oauthStateMachine;
    if (!machine) {
      throw new Error("Guided auth failed to initialize state");
    }

    while (true) {
      const state = this.oauthState;
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

    const state = this.oauthState;
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
    if (!this.oauthStateMachine || !this.oauthState) {
      throw new Error(
        "Not in guided OAuth flow. Call beginGuidedAuth() first.",
      );
    }
    const currentStep = this.oauthState.oauthStep;
    if (currentStep !== "authorization_code") {
      throw new Error(
        `Cannot set authorization code at step ${currentStep}. Expected step: authorization_code`,
      );
    }

    this.oauthState.authorizationCode = authorizationCode;

    if (completeFlow) {
      await this.oauthStateMachine.executeStep(this.oauthState);
      let step: OAuthStep = this.oauthState.oauthStep;
      while (step !== "complete") {
        await this.oauthStateMachine.executeStep(this.oauthState);
        step = this.oauthState.oauthStep;
      }

      if (!this.oauthState.oauthTokens) {
        throw new Error("Failed to exchange authorization code for tokens");
      }

      this.params.dispatchOAuthComplete({
        tokens: this.oauthState.oauthTokens,
      });
    } else {
      this.params.dispatchOAuthStepChange({
        step: this.oauthState.oauthStep,
        previousStep: this.oauthState.oauthStep,
        state: { authorizationCode },
      });
    }
  }

  async completeOAuthFlow(authorizationCode: string): Promise<void> {
    try {
      if (this.oauthStateMachine && this.oauthState) {
        await this.setGuidedAuthorizationCode(authorizationCode, true);
      } else {
        const provider = await this.createOAuthProvider("normal");
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
        this.oauthState = this.oauthState
          ? {
              ...this.oauthState,
              oauthStep: "complete",
              oauthTokens: tokens,
              oauthClientInfo: clientInfo ?? null,
              completedAt,
            }
          : {
              ...EMPTY_GUIDED_STATE,
              authType: "normal",
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
    if (this.oauthState?.oauthTokens) {
      return this.oauthState.oauthTokens;
    }

    const provider = await this.createOAuthProvider("normal");
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

    this.oauthState = null;
    this.oauthStateMachine = null;
  }

  async isOAuthAuthorized(): Promise<boolean> {
    const tokens = await this.getOAuthTokens();
    return tokens !== undefined;
  }

  getOAuthState(): AuthGuidedState | undefined {
    return this.oauthState ? { ...this.oauthState } : undefined;
  }

  getOAuthStep(): OAuthStep | undefined {
    return this.oauthState?.oauthStep;
  }

  async proceedOAuthStep(): Promise<void> {
    if (!this.oauthStateMachine || !this.oauthState) {
      throw new Error(
        "Not in guided OAuth flow. Call authenticateGuided() first.",
      );
    }

    await this.oauthStateMachine.executeStep(this.oauthState);
  }

  /**
   * Create an OAuth provider for transport auth (connect()).
   * Used only when isHttpOAuthConfig() is true.
   */
  async createOAuthProviderForTransport(): Promise<BaseOAuthClientProvider> {
    return this.createOAuthProvider("normal");
  }
}
