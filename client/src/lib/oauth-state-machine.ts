import { OAuthStep, AuthDebuggerState } from "./auth-types";
import { DebugInspectorOAuthClientProvider } from "./auth";
import {
  discoverOAuthMetadata,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthMetadataSchema } from "@modelcontextprotocol/sdk/shared/auth.js";

export interface StateMachineContext {
  state: AuthDebuggerState;
  serverUrl: string;
  provider: DebugInspectorOAuthClientProvider;
  updateState: (updates: Partial<AuthDebuggerState>) => void;
}

export interface StateTransition {
  canTransition: (context: StateMachineContext) => Promise<boolean>;
  execute: (context: StateMachineContext) => Promise<void>;
}

// State machine transitions
export const oauthTransitions: Record<OAuthStep, StateTransition> = {
  resource_metadata_discovery: {
    canTransition: async () => true,
    execute: async (context) => {
      // TODO: use sdk
      const url = new URL("/.well-known/oauth-protected-resource", context.serverUrl);
      const response = await fetch(url);

      const resourceMetadata = await response.json();
      context.updateState({
        resourceMetadata: resourceMetadata,
        oauthStep: "metadata_discovery",
      });
    },
  },

  metadata_discovery: {
    canTransition: async (context) => !!context.state.resourceMetadata,
    execute: async (context) => {
      // TODO: use sdk
      let authServerUrl = context.serverUrl;
      if (context.state.resourceMetadata?.authorization_servers?.[0]) {
        authServerUrl = context.state.resourceMetadata.authorization_servers[0];
      }
      const metadata = await discoverOAuthMetadata(authServerUrl);
      if (!metadata) {
        throw new Error("Failed to discover OAuth metadata");
      }
      const parsedMetadata = await OAuthMetadataSchema.parseAsync(metadata);
      context.provider.saveServerMetadata(parsedMetadata);
      context.updateState({
        oauthMetadata: parsedMetadata,
        oauthStep: "client_registration",
      });
    },
  },

  client_registration: {
    canTransition: async (context) => !!context.state.oauthMetadata,
    execute: async (context) => {
      const metadata = context.state.oauthMetadata!;
      const clientMetadata = context.provider.clientMetadata;

      // Add all supported scopes to client registration
      if (metadata.scopes_supported) {
        clientMetadata.scope = metadata.scopes_supported.join(" ");
      }

      const fullInformation = await registerClient(context.serverUrl, {
        metadata,
        clientMetadata,
      });

      context.provider.saveClientInformation(fullInformation);
      context.updateState({
        oauthClientInfo: fullInformation,
        oauthStep: "authorization_redirect",
      });
    },
  },

  authorization_redirect: {
    canTransition: async (context) =>
      !!context.state.oauthMetadata && !!context.state.oauthClientInfo,
    execute: async (context) => {
      const metadata = context.state.oauthMetadata!;
      const clientInformation = context.state.oauthClientInfo!;

      let scope: string | undefined = undefined;
      if (metadata.scopes_supported) {
        scope = metadata.scopes_supported.join(" ");
      }

      const { authorizationUrl, codeVerifier } = await startAuthorization(
        context.serverUrl,
        {
          metadata,
          clientInformation,
          redirectUrl: context.provider.redirectUrl,
          scope,
        },
      );

      context.provider.saveCodeVerifier(codeVerifier);
      context.updateState({
        authorizationUrl: authorizationUrl.toString(),
        oauthStep: "authorization_code",
      });
    },
  },

  authorization_code: {
    canTransition: async () => true,
    execute: async (context) => {
      if (
        !context.state.authorizationCode ||
        context.state.authorizationCode.trim() === ""
      ) {
        context.updateState({
          validationError: "You need to provide an authorization code",
        });
        // Don't advance if no code
        throw new Error("Authorization code required");
      }
      context.updateState({
        validationError: null,
        oauthStep: "token_request",
      });
    },
  },

  token_request: {
    canTransition: async (context) => {
      return (
        !!context.state.authorizationCode &&
        !!context.provider.getServerMetadata() &&
        !!(await context.provider.clientInformation())
      );
    },
    execute: async (context) => {
      const codeVerifier = context.provider.codeVerifier();
      const metadata = context.provider.getServerMetadata()!;
      const clientInformation = (await context.provider.clientInformation())!;

      const tokens = await exchangeAuthorization(context.serverUrl, {
        metadata,
        clientInformation,
        authorizationCode: context.state.authorizationCode,
        codeVerifier,
        redirectUri: context.provider.redirectUrl,
      });

      context.provider.saveTokens(tokens);
      context.updateState({
        oauthTokens: tokens,
        oauthStep: "complete",
      });
    },
  },

  complete: {
    canTransition: async () => false,
    execute: async () => {
      // No-op for complete state
    },
  },
};

export class OAuthStateMachine {
  constructor(
    private serverUrl: string,
    private updateState: (updates: Partial<AuthDebuggerState>) => void,
  ) {}

  async executeStep(state: AuthDebuggerState): Promise<void> {
    const provider = new DebugInspectorOAuthClientProvider(this.serverUrl);
    const context: StateMachineContext = {
      state,
      serverUrl: this.serverUrl,
      provider,
      updateState: this.updateState,
    };

    const transition = oauthTransitions[state.oauthStep];
    if (!(await transition.canTransition(context))) {
      throw new Error(`Cannot transition from ${state.oauthStep}`);
    }

    await transition.execute(context);
  }
}
