import { OAuthStep, AuthDebuggerState } from "./auth-types";
import { DebugInspectorOAuthClientProvider } from "./auth";
import {
  discoverOAuthMetadata,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  discoverOAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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
  metadata_discovery: {
    canTransition: async () => true,
    execute: async (context) => {
      // Default to discovering from the server's URL
      let authServerUrl = new URL("/", context.serverUrl);
      let resourceMetadata: OAuthProtectedResourceMetadata | null = null;
      let resourceMetadataError: Error | null = null;
      try {
        resourceMetadata = await discoverOAuthProtectedResourceMetadata(
          context.serverUrl,
        );
        if (resourceMetadata) {
          if (resourceMetadata.authorization_servers?.length) {
            authServerUrl = new URL(resourceMetadata.authorization_servers[0]);
          }
        }
      } catch (e) {
        if (e instanceof Error) {
          resourceMetadataError = e;
        } else {
          resourceMetadataError = new Error(String(e));
        }
      }

      if (resourceMetadata) {
        if (resourceMetadata.resource !== context.serverUrl) {
          throw new Error(
            `Resource URL from metadata does not match server URL. ${resourceMetadata.resource} != ${context.serverUrl}`,
          );
        }
      }

      const metadata = await discoverOAuthMetadata(authServerUrl);
      if (!metadata) {
        throw new Error("Failed to discover OAuth metadata");
      }
      const parsedMetadata = await OAuthMetadataSchema.parseAsync(metadata);
      context.provider.saveServerMetadata(parsedMetadata);
      context.updateState({
        resourceMetadata,
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

      // Prefer scopes from resource metadata if available
      const scopesSupported =
        context.state.resourceMetadata?.scopes_supported ||
        metadata.scopes_supported;
      // Add all supported scopes to client registration
      if (scopesSupported) {
        clientMetadata.scope = scopesSupported.join(" ");
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
          resource: new URL(context.serverUrl),
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
        resource: new URL(context.serverUrl),
      });

      context.provider.saveTokens(tokens);
      context.updateState({
        oauthTokens: tokens,
        oauthStep: "validate_token",
      });
    },
  },
  
  validate_token: {
    canTransition: async (context) => {
      return !!context.state.oauthTokens && !!context.state.oauthTokens.access_token;
    },
    execute: async (context) => {
      if (!context.state.oauthTokens?.access_token) {
        throw new Error("No access token available for validation");
      }

      try {
        // Create a simple client with the StreamableHTTP transport
        const transport = new StreamableHTTPClientTransport(
          new URL(context.serverUrl), 
          {
            requestInit: {
              headers: {
                Authorization: `Bearer ${context.state.oauthTokens.access_token}`
              }
            }
          }
        );
        
        const client = new Client(
          { name: "mcp-auth-validator", version: "1.0.0" },
          { capabilities: {} }
        );
        
        // Connect and list tools to validate the token
        await client.connect(transport);
        const response = await client.listTools();
        
        // Successfully validated token
        context.updateState({
          oauthStep: "complete",
          statusMessage: {
            type: "success",
            message: `Token validated successfully! Found ${response.tools?.length || 0} tools.`,
          },
        });
      } catch (error) {
        throw new Error(`Token validation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
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
