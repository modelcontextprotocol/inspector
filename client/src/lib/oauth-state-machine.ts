import {
  OAuthStep,
  AuthDebuggerState,
  OAuthClientAuthMethod,
} from "./auth-types";
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
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { generateOAuthState } from "@/utils/oauthUtils";

export interface StateMachineContext {
  state: AuthDebuggerState;
  serverUrl: string;
  provider: DebugInspectorOAuthClientProvider;
  updateState: (updates: Partial<AuthDebuggerState>) => void;
  certAuthConfig?: CertAuthConfig;
  proxyAddress?: string;
  proxyAuthToken?: string;
  proxyAuthHeader?: string;
}

export interface CertAuthConfig {
  authMethod: OAuthClientAuthMethod;
  certPath: string;
  keyPath: string;
  tokenEndpointUrl: string;
  authEndpointUrl: string;
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
      // Certificate auth: auto-discover via protected resource metadata + OIDC,
      // with manual endpoints as fallback
      if (context.certAuthConfig?.authMethod === "certificate") {
        let authEndpointUrl = context.certAuthConfig.authEndpointUrl;
        let tokenEndpointUrl = context.certAuthConfig.tokenEndpointUrl;

        // Try auto-discovery from MCP server's protected resource metadata
        if (!authEndpointUrl || !tokenEndpointUrl) {
          try {
            const resourceMetadata =
              await discoverOAuthProtectedResourceMetadata(context.serverUrl);
            if (resourceMetadata?.authorization_servers?.length) {
              const authServerUrl = resourceMetadata.authorization_servers[0];

              // Try OpenID Connect discovery (works with Azure AD, Auth0, etc.)
              const oidcUrl =
                authServerUrl.replace(/\/+$/, "") +
                "/.well-known/openid-configuration";
              const oidcResponse = await fetch(oidcUrl);
              if (oidcResponse.ok) {
                const oidcConfig = await oidcResponse.json();
                if (!authEndpointUrl && oidcConfig.authorization_endpoint) {
                  authEndpointUrl = oidcConfig.authorization_endpoint;
                }
                if (!tokenEndpointUrl && oidcConfig.token_endpoint) {
                  tokenEndpointUrl = oidcConfig.token_endpoint;
                }
              }
            }
          } catch (e) {
            console.debug("Auto-discovery failed, using manual endpoints:", e);
          }
        }

        if (!authEndpointUrl || !tokenEndpointUrl) {
          throw new Error(
            "Could not discover OAuth endpoints. Please provide the Authorization Endpoint URL and Token Endpoint URL manually.",
          );
        }

        const manualMetadata = {
          issuer: tokenEndpointUrl,
          authorization_endpoint: authEndpointUrl,
          token_endpoint: tokenEndpointUrl,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
        };
        const parsedMetadata =
          await OAuthMetadataSchema.parseAsync(manualMetadata);
        context.provider.saveServerMetadata(parsedMetadata);
        context.updateState({
          resourceMetadata: null,
          resource: undefined,
          resourceMetadataError: null,
          authServerUrl: new URL(authEndpointUrl),
          oauthMetadata: parsedMetadata,
          oauthStep: "client_registration",
        });
        return;
      }

      // Standard flow: discover from the server's URL
      let authServerUrl = new URL("/", context.serverUrl);
      let resourceMetadata: OAuthProtectedResourceMetadata | null = null;
      let resourceMetadataError: Error | null = null;
      try {
        resourceMetadata = await discoverOAuthProtectedResourceMetadata(
          context.serverUrl,
        );
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

      const metadata = await discoverAuthorizationServerMetadata(authServerUrl);
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
      // When cert auth with manual endpoints is configured, skip DCR
      // and use pre-registered client info directly
      if (context.certAuthConfig?.authMethod === "certificate") {
        const fullInformation = await context.provider.clientInformation();
        if (!fullInformation) {
          throw new Error(
            "Client ID is required for certificate authentication",
          );
        }
        context.updateState({
          oauthClientInfo: fullInformation,
          oauthStep: "authorization_redirect",
        });
        return;
      }

      const metadata = context.state.oauthMetadata!;
      const clientMetadata = context.provider.clientMetadata;

      // Priority: user-provided scope > discovered scopes
      if (!context.provider.scope || context.provider.scope.trim() === "") {
        // Prefer scopes from resource metadata if available
        const scopesSupported =
          context.state.resourceMetadata?.scopes_supported ||
          metadata.scopes_supported;
        // Add all supported scopes to client registration
        if (scopesSupported) {
          clientMetadata.scope = scopesSupported.join(" ");
        }
      }

      // Try Static client first, with DCR as fallback
      let fullInformation = await context.provider.clientInformation();
      if (!fullInformation) {
        fullInformation = await registerClient(context.serverUrl, {
          metadata,
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
      let scope = context.provider.scope;
      if (!scope || scope.trim() === "") {
        scope = await discoverScopes(
          context.serverUrl,
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
      const clientInformation = (await context.provider.clientInformation())!;

      // Check if certificate auth is active
      if (context.certAuthConfig?.authMethod === "certificate") {
        const { certPath, keyPath, tokenEndpointUrl } = context.certAuthConfig;

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (context.proxyAuthToken && context.proxyAuthHeader) {
          headers[context.proxyAuthHeader] = `Bearer ${context.proxyAuthToken}`;
        }

        const response = await fetch(
          `${context.proxyAddress}/oauth/token/certificate`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              clientId: clientInformation.client_id,
              tokenEndpointUrl,
              certPath,
              keyPath,
              authorizationCode: context.state.authorizationCode,
              redirectUri: context.provider.redirectUrl,
              codeVerifier,
              scope: context.provider.scope || undefined,
            }),
          },
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            `Certificate token exchange failed: ${errorData.message || errorData.error || response.statusText}`,
          );
        }

        const tokenData = await response.json();
        const tokens = await OAuthTokensSchema.parseAsync(tokenData);
        context.provider.saveTokens(tokens);
        context.updateState({
          oauthTokens: tokens,
          oauthStep: "complete",
        });
      } else {
        // Standard token exchange
        const metadata = context.provider.getServerMetadata()!;
        const tokens = await exchangeAuthorization(context.serverUrl, {
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
    private certAuthConfig?: CertAuthConfig,
    private proxyAddress?: string,
    private proxyAuthToken?: string,
    private proxyAuthHeader?: string,
  ) {}

  async executeStep(state: AuthDebuggerState): Promise<void> {
    const provider = new DebugInspectorOAuthClientProvider(this.serverUrl);
    const context: StateMachineContext = {
      state,
      serverUrl: this.serverUrl,
      provider,
      updateState: this.updateState,
      certAuthConfig: this.certAuthConfig,
      proxyAddress: this.proxyAddress,
      proxyAuthToken: this.proxyAuthToken,
      proxyAuthHeader: this.proxyAuthHeader,
    };

    const transition = oauthTransitions[state.oauthStep];
    if (!(await transition.canTransition(context))) {
      throw new Error(`Cannot transition from ${state.oauthStep}`);
    }

    await transition.execute(context);
  }
}
