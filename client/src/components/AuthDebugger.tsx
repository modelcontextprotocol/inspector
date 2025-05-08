import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { InspectorOAuthClientProvider } from "../lib/auth";
import {
  auth,
  discoverOAuthMetadata,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthMetadataSchema,
  OAuthMetadata,
  OAuthClientInformation,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { CheckCircle2, Circle, ExternalLink, AlertCircle } from "lucide-react";
import { AuthDebuggerState } from "../lib/auth-types";
import { SESSION_KEYS, getServerSpecificKey } from "../lib/constants";

export interface AuthDebuggerProps {
  sseUrl: string;
  onBack: () => void;
  authState: AuthDebuggerState;
  updateAuthState: (updates: Partial<AuthDebuggerState>) => void;
}

// Overrides debug URL and allows saving server OAuth metadata to
// display in debug UI.
class DebugInspectorOAuthClientProvider extends InspectorOAuthClientProvider {
  get redirectUrl(): string {
    return `${window.location.origin}/oauth/callback/debug`;
  }

  saveServerMetadata(metadata: OAuthMetadata) {
    const key = getServerSpecificKey(
      SESSION_KEYS.SERVER_METADATA,
      this.serverUrl,
    );
    sessionStorage.setItem(key, JSON.stringify(metadata));
  }

  getServerMetadata(): OAuthMetadata | null {
    const key = getServerSpecificKey(
      SESSION_KEYS.SERVER_METADATA,
      this.serverUrl,
    );
    const metadata = sessionStorage.getItem(key);
    if (!metadata) {
      return null;
    }
    return JSON.parse(metadata);
  }
}

const AuthDebugger = ({
  sseUrl,
  onBack,
  authState,
  updateAuthState,
}: AuthDebuggerProps) => {
  // Load client info asynchronously when we're at the token_request step

  // These functions will be moved inside proceedToNextStep to avoid ESLint warning

  const startOAuthFlow = useCallback(() => {
    if (!sseUrl) {
      updateAuthState({
        statusMessage: {
          type: "error",
          message:
            "Please enter a server URL in the sidebar before authenticating",
        },
      });
      return;
    }

    updateAuthState({
      oauthStep: "not_started",
      authorizationUrl: null,
      statusMessage: null,
      latestError: null,
    });
  }, [sseUrl, updateAuthState]);

  const proceedToNextStep = useCallback(async () => {
    if (!sseUrl) return;
    const provider = new DebugInspectorOAuthClientProvider(sseUrl);

    // Helper functions moved inside useCallback to avoid ESLint warning
    const validateOAuthMetadata = async (
      provider: DebugInspectorOAuthClientProvider,
    ): Promise<OAuthMetadata> => {
      const metadata = provider.getServerMetadata();
      if (metadata) {
        return metadata;
      }

      const fetchedMetadata = await discoverOAuthMetadata(sseUrl);
      if (!fetchedMetadata) {
        throw new Error("Failed to discover OAuth metadata");
      }
      const parsedMetadata =
        await OAuthMetadataSchema.parseAsync(fetchedMetadata);

      return parsedMetadata;
    };

    const validateClientInformation = async (
      provider: DebugInspectorOAuthClientProvider,
    ): Promise<OAuthClientInformation> => {
      const clientInformation = await provider.clientInformation();

      if (!clientInformation) {
        throw new Error("Can't advance without successful client registration");
      }
      return clientInformation;
    };

    try {
      updateAuthState({
        isInitiatingAuth: true,
        statusMessage: null,
        latestError: null,
      });

      if (authState.oauthStep === "not_started") {
        updateAuthState({ oauthStep: "metadata_discovery" });
        const metadata = await discoverOAuthMetadata(sseUrl);
        if (!metadata) {
          throw new Error("Failed to discover OAuth metadata");
        }
        const parsedMetadata = await OAuthMetadataSchema.parseAsync(metadata);
        updateAuthState({ oauthMetadata: parsedMetadata });
        provider.saveServerMetadata(parsedMetadata);
      } else if (authState.oauthStep === "metadata_discovery") {
        const metadata = await validateOAuthMetadata(provider);

        updateAuthState({ oauthStep: "client_registration" });

        const clientMetadata = provider.clientMetadata;
        // Add all supported scopes to client registration.
        if (metadata.scopes_supported) {
          clientMetadata.scope = metadata.scopes_supported.join(" ");
        }

        const fullInformation = await registerClient(sseUrl, {
          metadata,
          clientMetadata,
        });

        provider.saveClientInformation(fullInformation);
        updateAuthState({ oauthClientInfo: fullInformation });
      } else if (authState.oauthStep === "client_registration") {
        const metadata = await validateOAuthMetadata(provider);
        const clientInformation = await validateClientInformation(provider);
        updateAuthState({ oauthStep: "authorization_redirect" });
        try {
          const { authorizationUrl, codeVerifier } = await startAuthorization(
            sseUrl,
            {
              metadata,
              clientInformation,
              redirectUrl: provider.redirectUrl,
            },
          );

          provider.saveCodeVerifier(codeVerifier);

          if (metadata.scopes_supported) {
            const url = new URL(authorizationUrl.toString());
            url.searchParams.set("scope", metadata.scopes_supported.join(" "));
            updateAuthState({ authorizationUrl: url.toString() });
          } else {
            updateAuthState({ authorizationUrl: authorizationUrl.toString() });
          }

          updateAuthState({ oauthStep: "authorization_code" });
        } catch (error) {
          console.error("OAuth flow step error:", error);
          throw new Error(
            `Failed to complete OAuth setup: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } else if (authState.oauthStep === "authorization_code") {
        if (
          !authState.authorizationCode ||
          authState.authorizationCode.trim() === ""
        ) {
          updateAuthState({
            validationError: "You need to provide an authorization code",
          });
          return;
        }
        updateAuthState({ validationError: null, oauthStep: "token_request" });
      } else if (authState.oauthStep === "token_request") {
        const codeVerifier = provider.codeVerifier();
        const metadata = await validateOAuthMetadata(provider);
        const clientInformation = await validateClientInformation(provider);

        const tokens = await exchangeAuthorization(sseUrl, {
          metadata,
          clientInformation,
          authorizationCode: authState.authorizationCode,
          codeVerifier,
          redirectUri: provider.redirectUrl,
        });

        provider.saveTokens(tokens);
        updateAuthState({ oauthTokens: tokens, oauthStep: "complete" });
      }
    } catch (error) {
      console.error("OAuth flow error:", error);
      updateAuthState({
        latestError: error instanceof Error ? error : new Error(String(error)),
      });
    } finally {
      updateAuthState({ isInitiatingAuth: false });
    }
  }, [sseUrl, authState, updateAuthState]);

  const handleStartOAuth = useCallback(async () => {
    if (!sseUrl) {
      updateAuthState({
        statusMessage: {
          type: "error",
          message:
            "Please enter a server URL in the sidebar before authenticating",
        },
      });
      return;
    }

    updateAuthState({ isInitiatingAuth: true, statusMessage: null });
    try {
      const serverAuthProvider = new DebugInspectorOAuthClientProvider(sseUrl);
      await auth(serverAuthProvider, { serverUrl: sseUrl });
      updateAuthState({
        statusMessage: {
          type: "info",
          message: "Starting OAuth authentication process...",
        },
      });
    } catch (error) {
      console.error("OAuth initialization error:", error);
      updateAuthState({
        statusMessage: {
          type: "error",
          message: `Failed to start OAuth flow: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    } finally {
      updateAuthState({ isInitiatingAuth: false });
    }
  }, [sseUrl, updateAuthState]);

  const handleClearOAuth = useCallback(() => {
    if (sseUrl) {
      const serverAuthProvider = new DebugInspectorOAuthClientProvider(sseUrl);
      serverAuthProvider.clear();
      updateAuthState({
        oauthTokens: null,
        oauthStep: "not_started",
        latestError: null,
        oauthClientInfo: null,
        authorizationCode: "",
        validationError: null,
        statusMessage: {
          type: "success",
          message: "OAuth tokens cleared successfully",
        },
      });

      // Clear success message after 3 seconds
      setTimeout(() => {
        updateAuthState({ statusMessage: null });
      }, 3000);
    }
  }, [sseUrl, updateAuthState]);

  const renderStatusMessage = useCallback(() => {
    if (!authState.statusMessage) return null;

    const bgColor =
      authState.statusMessage.type === "error"
        ? "bg-red-50"
        : authState.statusMessage.type === "success"
          ? "bg-green-50"
          : "bg-blue-50";
    const textColor =
      authState.statusMessage.type === "error"
        ? "text-red-700"
        : authState.statusMessage.type === "success"
          ? "text-green-700"
          : "text-blue-700";
    const borderColor =
      authState.statusMessage.type === "error"
        ? "border-red-200"
        : authState.statusMessage.type === "success"
          ? "border-green-200"
          : "border-blue-200";

    return (
      <div
        className={`p-3 rounded-md border ${bgColor} ${borderColor} ${textColor} mb-4`}
      >
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          <p className="text-sm">{authState.statusMessage.message}</p>
        </div>
      </div>
    );
  }, [authState.statusMessage]);

  const renderOAuthFlow = useCallback(() => {
    const provider = new DebugInspectorOAuthClientProvider(sseUrl);
    const steps = [
      {
        key: "not_started",
        label: "Starting OAuth Flow",
        metadata: null,
      },
      {
        key: "metadata_discovery",
        label: "Metadata Discovery",
        metadata: provider.getServerMetadata() && (
          <details className="text-xs mt-2">
            <summary className="cursor-pointer text-muted-foreground font-medium">
              Retrieved OAuth Metadata from {sseUrl}
              /.well-known/oauth-authorization-server
            </summary>
            <pre className="mt-2 p-2 bg-muted rounded-md overflow-auto max-h-[300px]">
              {JSON.stringify(provider.getServerMetadata(), null, 2)}
            </pre>
          </details>
        ),
      },
      {
        key: "client_registration",
        label: "Client Registration",
        metadata: authState.oauthClientInfo && (
          <details className="text-xs mt-2">
            <summary className="cursor-pointer text-muted-foreground font-medium">
              Registered Client Information
            </summary>
            <pre className="mt-2 p-2 bg-muted rounded-md overflow-auto max-h-[300px]">
              {JSON.stringify(authState.oauthClientInfo, null, 2)}
            </pre>
          </details>
        ),
      },
      {
        key: "authorization_redirect",
        label: "Preparing Authorization",
        metadata: authState.authorizationUrl && (
          <div className="mt-2 p-3 border rounded-md bg-muted">
            <p className="font-medium mb-2 text-sm">Authorization URL:</p>
            <div className="flex items-center gap-2">
              <p className="text-xs break-all">{authState.authorizationUrl}</p>
              <a
                href={authState.authorizationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center text-blue-500 hover:text-blue-700"
                aria-label="Open authorization URL in new tab"
                title="Open authorization URL"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Click the link to authorize in your browser. After authorization,
              you'll be redirected back to continue the flow.
            </p>
          </div>
        ),
      },
      {
        key: "authorization_code",
        label: "Request Authorization and acquire authorization code",
        metadata: (
          <div className="mt-3">
            <label
              htmlFor="authCode"
              className="block text-sm font-medium mb-1"
            >
              Authorization Code
            </label>
            <div className="flex gap-2">
              <input
                id="authCode"
                value={authState.authorizationCode}
                onChange={(e) => {
                  updateAuthState({
                    authorizationCode: e.target.value,
                    validationError: null,
                  });
                }}
                placeholder="Enter the code from the authorization server"
                className={`flex h-9 w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  authState.validationError ? "border-red-500" : "border-input"
                }`}
              />
            </div>
            {authState.validationError && (
              <p className="text-xs text-red-600 mt-1">
                {authState.validationError}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Once you've completed authorization in the link, paste the code
              here.
            </p>
          </div>
        ),
      },
      {
        key: "token_request",
        label: "Token Request",
        metadata: authState.oauthMetadata && (
          <details className="text-xs mt-2">
            <summary className="cursor-pointer text-muted-foreground font-medium">
              Token Request Details
            </summary>
            <div className="mt-2 p-2 bg-muted rounded-md">
              <p className="font-medium">Token Endpoint:</p>
              <code className="block mt-1 text-xs overflow-x-auto">
                {authState.oauthMetadata.token_endpoint}
              </code>
            </div>
          </details>
        ),
      },
      {
        key: "complete",
        label: "Authentication Complete",
        metadata: authState.oauthTokens && (
          <details className="text-xs mt-2">
            <summary className="cursor-pointer text-muted-foreground font-medium">
              Access Tokens
            </summary>
            <p className="mt-1 text-sm">
              Authentication successful! You can now use the authenticated
              connection. These tokens will be used automatically for server
              requests.
            </p>
            <pre className="mt-2 p-2 bg-muted rounded-md overflow-auto max-h-[300px]">
              {JSON.stringify(authState.oauthTokens, null, 2)}
            </pre>
          </details>
        ),
      },
    ];

    return (
      <div className="rounded-md border p-6 space-y-4 mt-4">
        <h3 className="text-lg font-medium">OAuth Flow Progress</h3>
        <p className="text-sm text-muted-foreground">
          Follow these steps to complete OAuth authentication with the server.
        </p>

        <div className="space-y-3">
          {steps.map((step, idx) => {
            const currentStepIdx = steps.findIndex(
              (s) => s.key === authState.oauthStep,
            );
            const isComplete = idx <= currentStepIdx;
            const isCurrent = step.key === authState.oauthStep;

            return (
              <div key={step.key}>
                <div
                  className={`flex items-center p-2 rounded-md ${isCurrent ? "bg-accent" : ""}`}
                >
                  {isComplete ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500 mr-2" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground mr-2" />
                  )}
                  <span className={`${isCurrent ? "font-medium" : ""}`}>
                    {step.label}
                  </span>
                </div>

                {/* Show step metadata if current step and metadata exists */}
                {(isCurrent || isComplete) && step.metadata && (
                  <div className="ml-7 mt-1">{step.metadata}</div>
                )}

                {/* Display error if current step and an error exists */}
                {isCurrent && authState.latestError && (
                  <div className="ml-7 mt-2 p-3 border border-red-300 bg-red-50 rounded-md">
                    <p className="text-sm font-medium text-red-700">Error:</p>
                    <p className="text-xs text-red-600 mt-1">
                      {authState.latestError.message}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-3 mt-4">
          {authState.oauthStep !== "complete" && (
            <Button
              onClick={proceedToNextStep}
              disabled={authState.isInitiatingAuth}
            >
              {authState.isInitiatingAuth
                ? "Processing..."
                : authState.oauthStep === "authorization_redirect" &&
                    authState.authorizationUrl
                  ? "Open Authorization URL"
                  : "Continue"}
            </Button>
          )}

          {authState.oauthStep === "authorization_redirect" &&
            authState.authorizationUrl && (
              <Button
                variant="outline"
                onClick={() =>
                  window.open(authState.authorizationUrl!, "_blank")
                }
              >
                Open in New Tab
              </Button>
            )}
        </div>
      </div>
    );
  }, [authState, sseUrl, proceedToNextStep, updateAuthState]);

  return (
    <div className="w-full p-4">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Authentication Settings</h2>
        <Button variant="outline" onClick={onBack}>
          Back to Connect
        </Button>
      </div>

      <div className="w-full space-y-6">
        <div className="flex flex-col gap-6">
          <div className="grid w-full gap-2">
            <p className="text-muted-foreground mb-4">
              Configure authentication settings for your MCP server connection.
            </p>

            <div className="rounded-md border p-6 space-y-6">
              <h3 className="text-lg font-medium">OAuth Authentication</h3>
              <p className="text-sm text-muted-foreground mb-2">
                Use OAuth to securely authenticate with the MCP server.
              </p>

              {renderStatusMessage()}

              {authState.loading ? (
                <p>Loading authentication status...</p>
              ) : (
                <div className="space-y-4">
                  {authState.oauthTokens && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Access Token:</p>
                      <div className="bg-muted p-2 rounded-md text-xs overflow-x-auto">
                        {authState.oauthTokens.access_token.substring(0, 25)}...
                      </div>
                    </div>
                  )}

                  <div className="flex gap-4">
                    <Button
                      variant="outline"
                      onClick={startOAuthFlow}
                      disabled={authState.isInitiatingAuth}
                    >
                      {authState.oauthTokens
                        ? "Guided Token Refresh"
                        : "Guided OAuth Flow"}
                    </Button>

                    <Button
                      onClick={handleStartOAuth}
                      disabled={authState.isInitiatingAuth}
                    >
                      {authState.isInitiatingAuth
                        ? "Initiating..."
                        : authState.oauthTokens
                          ? "Quick Refresh"
                          : "Quick OAuth Flow"}
                    </Button>

                    <Button variant="outline" onClick={handleClearOAuth}>
                      Clear OAuth State
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Choose "Guided" for step-by-step instructions or "Quick" for
                    the standard automatic flow.
                  </p>
                </div>
              )}
            </div>

            {renderOAuthFlow()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthDebugger;
