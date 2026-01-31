import type { OAuthStep, AuthGuidedState } from "./types.js";
import type { BaseOAuthClientProvider } from "./providers.js";
import { discoverScopes } from "./discovery.js";
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
  type OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { generateOAuthState } from "./utils.js";

export interface StateMachineContext {
  state: AuthGuidedState;
  serverUrl: string;
  provider: BaseOAuthClientProvider;
  updateState: (updates: Partial<AuthGuidedState>) => void;
  fetchFn?: typeof fetch;
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
      let authServerUrl: URL = new URL("/", context.serverUrl);
      let resourceMetadata: OAuthProtectedResourceMetadata | null = null;
      let resourceMetadataError: Error | null = null;
      try {
        resourceMetadata = await discoverOAuthProtectedResourceMetadata(
          context.serverUrl as string | URL,
        );
        if (resourceMetadata?.authorization_servers?.length) {
          const firstServer = resourceMetadata.authorization_servers[0];
          if (firstServer) {
            authServerUrl = new URL(firstServer);
          }
        }
      } catch (e) {
        if (e instanceof Error) {
          resourceMetadataError = e;
        } else {
          resourceMetadataError = new Error(String(e));
        }
      }

      const resource: URL | undefined = resourceMetadata
        ? await selectResourceURL(
            context.serverUrl,
            context.provider,
            resourceMetadata,
          )
        : undefined;

      const metadata = await discoverAuthorizationServerMetadata(
        authServerUrl,
        {
          ...(context.fetchFn && { fetchFn: context.fetchFn }),
        },
      );
      if (!metadata) {
        throw new Error("Failed to discover OAuth metadata");
      }
      const parsedMetadata = await OAuthMetadataSchema.parseAsync(metadata);

      await context.provider.saveServerMetadata(parsedMetadata);

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
        // Add all supported scopes to client registration
        if (scopesSupported) {
          clientMetadata.scope = scopesSupported.join(" ");
        }
      }

      // Use pre-set client info from state (static client) when present; otherwise provider lookup → CIMD → DCR
      let fullInformation =
        context.state.oauthClientInfo ??
        (await context.provider.clientInformation());
      if (!fullInformation) {
        // Check if provider has clientMetadataUrl (CIMD mode)
        const clientMetadataUrl =
          "clientMetadataUrl" in context.provider &&
          context.provider.clientMetadataUrl
            ? context.provider.clientMetadataUrl
            : undefined;

        // Check for CIMD support (SDK handles this in authInternal - we replicate it here)
        const supportsUrlBasedClientId =
          metadata?.client_id_metadata_document_supported === true;
        const shouldUseUrlBasedClientId =
          supportsUrlBasedClientId && clientMetadataUrl;

        if (shouldUseUrlBasedClientId) {
          // SEP-991: URL-based Client IDs (CIMD)
          // SDK creates { client_id: clientMetadataUrl } directly - no registration needed
          fullInformation = {
            client_id: clientMetadataUrl,
          };
        } else {
          // Fallback to DCR registration
          fullInformation = await registerClient(context.serverUrl, {
            metadata,
            clientMetadata,
            ...(context.fetchFn && { fetchFn: context.fetchFn }),
          });
        }
        await context.provider.saveClientInformation(fullInformation);
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
          context.fetchFn,
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

      await context.provider.saveCodeVerifier(codeVerifier);
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
      const hasMetadata = !!context.provider.getServerMetadata();
      const clientInfo =
        context.state.oauthClientInfo ??
        (await context.provider.clientInformation());
      return !!context.state.authorizationCode && hasMetadata && !!clientInfo;
    },
    execute: async (context) => {
      const codeVerifier = context.provider.codeVerifier();
      const metadata = context.provider.getServerMetadata();

      if (!metadata) {
        throw new Error("OAuth metadata not available");
      }

      const clientInformation =
        context.state.oauthClientInfo ??
        (await context.provider.clientInformation());
      if (!clientInformation) {
        throw new Error("Client information not available for token exchange");
      }

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
        ...(context.fetchFn && { fetchFn: context.fetchFn }),
      });

      await context.provider.saveTokens(tokens);
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
    private provider: BaseOAuthClientProvider,
    private updateState: (updates: Partial<AuthGuidedState>) => void,
    private fetchFn?: typeof fetch,
  ) {}

  async executeStep(state: AuthGuidedState): Promise<void> {
    const context: StateMachineContext = {
      state,
      serverUrl: this.serverUrl,
      provider: this.provider,
      updateState: this.updateState,
      ...(this.fetchFn && { fetchFn: this.fetchFn }),
    };

    const transition = oauthTransitions[state.oauthStep];
    if (!(await transition.canTransition(context))) {
      throw new Error(`Cannot transition from ${state.oauthStep}`);
    }

    await transition.execute(context);
  }
}
