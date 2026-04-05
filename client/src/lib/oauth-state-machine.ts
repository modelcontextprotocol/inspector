import { OAuthStep, AuthDebuggerState } from "./auth-types";
import { DebugInspectorOAuthClientProvider, discoverScopes } from "./auth";
import {
  discoverAuthorizationServerMetadata,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  discoverOAuthProtectedResourceMetadata,
  selectResourceURL,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { generateOAuthState } from "@/utils/oauthUtils";
import { InspectorConfig } from "./configurationTypes";
import {
  discoverAuthorizationServerMetadataViaProxy,
  discoverOAuthProtectedResourceMetadataViaProxy,
  registerClientViaProxy,
  exchangeAuthorizationViaProxy,
} from "./oauth-proxy";

export interface StateMachineContext {
  state: AuthDebuggerState;
  serverUrl: string;
  provider: DebugInspectorOAuthClientProvider;
  updateState: (updates: Partial<AuthDebuggerState>) => void;
  connectionType: "direct" | "proxy";
  config: InspectorConfig;
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
      // Default to discovering from the server's URL
      let authServerUrl = new URL("/", context.serverUrl);
      let resourceMetadata: OAuthProtectedResourceMetadata | null = null;
      let resourceMetadataError: Error | null = null;
      try {
        // Use proxy if connectionType is "proxy"
        if (context.connectionType === "proxy") {
          resourceMetadata =
            await discoverOAuthProtectedResourceMetadataViaProxy(
              context.serverUrl,
              context.config,
            );
        } else {
          resourceMetadata = await discoverOAuthProtectedResourceMetadata(
            context.serverUrl,
          );
        }
        if (resourceMetadata?.authorization_servers?.length) {
          authServerUrl = new URL(resourceMetadata.authorization_servers[0]);
        }
      } catch (e) {
        if (e instanceof Error) {
          resourceMetadataError = e;
        } else {
          resourceMetadataError = new Error(String(e));
        }
      }

      const resource: URL | undefined = await selectResourceURL(
        context.serverUrl,
        context.provider,
        // we default to null, so swap it for undefined if not set
        resourceMetadata ?? undefined,
      );

      // Use proxy if connectionType is "proxy"
      const metadata =
        context.connectionType === "proxy"
          ? await discoverAuthorizationServerMetadataViaProxy(
              authServerUrl,
              context.config,
            )
          : await discoverAuthorizationServerMetadata(authServerUrl);

      if (!metadata) {
        throw new Error("Failed to discover OAuth metadata");
      }
      const parsedMetadata = await OAuthMetadataSchema.parseAsync(metadata);
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
      if (!context.provider.scope || context.provider.scope.trim() === "") {
        // Prefer scopes from resource metadata if available
        const scopesSupported =
          context.state.resourceMetadata?.scopes_supported ||
          metadata.scopes_supported;
        // Add all supported scopes to client registration (only if non-empty)
        if (scopesSupported && scopesSupported.length > 0) {
          clientMetadata.scope = scopesSupported.join(" ");
        }
      }

      // Try Static client first, with DCR as fallback
      let fullInformation = await context.provider.clientInformation();
      if (!fullInformation) {
        // Use proxy if connectionType is "proxy"
        if (context.connectionType === "proxy") {
          if (!metadata.registration_endpoint) {
            throw new Error(
              "No registration endpoint available for dynamic client registration",
            );
          }
          fullInformation = await registerClientViaProxy(
            metadata.registration_endpoint,
            clientMetadata,
            context.config,
          );
        } else {
          fullInformation = await registerClient(context.serverUrl, {
            metadata,
            clientMetadata,
          });
        }
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
      let scope = context.provider.scope;
      if (!scope || scope.trim() === "") {
        scope = await discoverScopes(
          context.serverUrl,
          context.connectionType,
          context.config,
          context.state.resourceMetadata ?? undefined,
        );
      }

      const { authorizationUrl, codeVerifier } = await startAuthorization(
        context.serverUrl,
        {
          metadata,
          clientInformation,
          redirectUrl: context.provider.redirectUrl,
          scope,
          state: generateOAuthState(),
          resource: context.state.resource ?? undefined,
        },
      );

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

      let tokens;

      // Use proxy if connectionType is "proxy"
      if (context.connectionType === "proxy") {
        // Build the token request parameters
        const params: Record<string, string> = {
          grant_type: "authorization_code",
          code: context.state.authorizationCode,
          redirect_uri: context.provider.redirectUrl,
          code_verifier: codeVerifier,
          client_id: clientInformation.client_id,
        };

        if (clientInformation.client_secret) {
          params.client_secret = clientInformation.client_secret;
        }

        if (context.state.resource) {
          const resourceUrl =
            context.state.resource instanceof URL
              ? context.state.resource.toString()
              : context.state.resource;
          params.resource = resourceUrl;
        }

        tokens = await exchangeAuthorizationViaProxy(
          metadata.token_endpoint,
          params,
          context.config,
        );
      } else {
        tokens = await exchangeAuthorization(context.serverUrl, {
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
      }

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
    private connectionType: "direct" | "proxy",
    private config: InspectorConfig,
  ) {}

  async executeStep(state: AuthDebuggerState): Promise<void> {
    const provider = new DebugInspectorOAuthClientProvider(this.serverUrl);
    const context: StateMachineContext = {
      state,
      serverUrl: this.serverUrl,
      provider,
      updateState: this.updateState,
      connectionType: this.connectionType,
      config: this.config,
    };

    const transition = oauthTransitions[state.oauthStep];
    if (!(await transition.canTransition(context))) {
      throw new Error(`Cannot transition from ${state.oauthStep}`);
    }

    await transition.execute(context);
  }
}
