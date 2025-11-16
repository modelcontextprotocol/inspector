import { OAuthStep, AuthDebuggerState } from "./auth-types";
import { DebugInspectorOAuthClientProvider } from "./auth";
import { selectResourceURL } from "@modelcontextprotocol/sdk/client/auth.js";
import { generateOAuthState } from "@/utils/oauthUtils";
import { OAuthProvider } from "./oauth/provider-interface";
import { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

export interface StateMachineContext {
  state: AuthDebuggerState;
  serverUrl: string;
  provider: DebugInspectorOAuthClientProvider;
  oauthProvider: OAuthProvider;
  updateState: (updates: Partial<AuthDebuggerState>) => void;
}

/**
 * Helper function to resolve scope - either use user-provided scope or discover it
 */
async function resolveScope(
  userScope: string | undefined,
  oauthProvider: OAuthProvider,
  serverUrl: string,
  resourceMetadata?: OAuthProtectedResourceMetadata | null,
): Promise<string | undefined> {
  if (userScope && userScope.trim() !== "") {
    return userScope;
  }

  return await oauthProvider.discoverScopes(
    serverUrl,
    resourceMetadata ?? undefined,
  );
}

export interface StateTransition {
  canTransition: (context: StateMachineContext) => Promise<boolean>;
  execute: (context: StateMachineContext) => Promise<void>;
}

// State machine transitions
export const oauthTransitions: Record<OAuthStep, StateTransition> = {
  metadata_discovery: {
    canTransition: async () => true,
    execute: async (context) => {
      let resourceMetadataError: Error | null = null;

      // Use the OAuth provider to discover metadata
      const discoveryResult = await context.oauthProvider
        .discover(context.serverUrl)
        .catch((e) => {
          resourceMetadataError = e instanceof Error ? e : new Error(String(e));
          throw e;
        });

      const resourceMetadata = discoveryResult.resourceMetadata;
      const parsedMetadata = discoveryResult.authServerMetadata;

      // Determine auth server URL from metadata
      let authServerUrl = new URL(parsedMetadata.issuer);
      if (resourceMetadata?.authorization_servers?.length) {
        authServerUrl = new URL(resourceMetadata.authorization_servers[0]);
      }

      const resource: URL | undefined = await selectResourceURL(
        context.serverUrl,
        context.provider,
        resourceMetadata ?? undefined,
      );

      context.provider.saveServerMetadata(parsedMetadata);
      context.updateState({
        resourceMetadata,
        resource,
        resourceMetadataError,
        authServerUrl,
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

      // Priority: user-provided scope > discovered scopes
      const discoveredScope = await resolveScope(
        context.provider.scope,
        context.oauthProvider,
        context.serverUrl,
        context.state.resourceMetadata,
      );

      // Add all supported scopes to client registration
      if (discoveredScope) {
        clientMetadata.scope = discoveredScope;
      }

      // Try Static client first, with DCR as fallback
      let fullInformation = await context.provider.clientInformation();
      if (!fullInformation) {
        fullInformation = await context.oauthProvider.registerClient({
          metadata,
          authServerUrl: context.serverUrl,
          clientMetadata,
        });
        context.provider.saveClientInformation(fullInformation);
      }

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

      // Priority: user-provided scope > discovered scopes
      const scope = await resolveScope(
        context.provider.scope,
        context.oauthProvider,
        context.serverUrl,
        context.state.resourceMetadata,
      );

      const { authorizationUrl, codeVerifier } =
        await context.oauthProvider.startAuthorization({
          metadata,
          clientInformation,
          redirectUrl: context.provider.redirectUrl,
          scope: scope || "",
          state: generateOAuthState(),
          resource: context.state.resource ?? undefined,
        });

      context.provider.saveCodeVerifier(codeVerifier);
      context.updateState({
        authorizationUrl: authorizationUrl,
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

      const tokens = await context.oauthProvider.exchangeToken({
        metadata,
        clientInformation,
        authorizationCode: context.state.authorizationCode,
        codeVerifier,
        redirectUri: context.provider.redirectUrl,
        resource: context.state.resource
          ? context.state.resource instanceof URL
            ? context.state.resource
            : new URL(context.state.resource)
          : undefined,
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
    private oauthProvider: OAuthProvider,
    private useDebugRedirect: boolean = true,
  ) {}

  async executeStep(state: AuthDebuggerState): Promise<void> {
    // Always use DebugInspectorOAuthClientProvider, but it will use
    // regular or debug redirect URL based on useDebugRedirect flag
    const provider = new DebugInspectorOAuthClientProvider(
      this.serverUrl,
      this.useDebugRedirect,
    );

    const context: StateMachineContext = {
      state,
      serverUrl: this.serverUrl,
      provider,
      oauthProvider: this.oauthProvider,
      updateState: this.updateState,
    };

    const transition = oauthTransitions[state.oauthStep];
    if (!(await transition.canTransition(context))) {
      throw new Error(`Cannot transition from ${state.oauthStep}`);
    }

    await transition.execute(context);
  }
}
