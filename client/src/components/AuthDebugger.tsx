import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { DebugInspectorOAuthClientProvider } from "../lib/auth";
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
import { AlertCircle } from "lucide-react";
import { AuthDebuggerState } from "../lib/auth-types";
import { OAuthFlowProgress } from "./OAuthFlowProgress";

export interface AuthDebuggerProps {
  serverUrl: string;
  onBack: () => void;
  authState: AuthDebuggerState;
  updateAuthState: (updates: Partial<AuthDebuggerState>) => void;
}

interface StatusMessageProps {
  message: { type: "error" | "success" | "info"; message: string };
}

const StatusMessage = ({ message }: StatusMessageProps) => {
  let bgColor: string;
  let textColor: string;
  let borderColor: string;

  switch (message.type) {
    case "error":
      bgColor = "bg-red-50";
      textColor = "text-red-700";
      borderColor = "border-red-200";
      break;
    case "success":
      bgColor = "bg-green-50";
      textColor = "text-green-700";
      borderColor = "border-green-200";
      break;
    case "info":
    default:
      bgColor = "bg-blue-50";
      textColor = "text-blue-700";
      borderColor = "border-blue-200";
      break;
  }

  return (
    <div
      className={`p-3 rounded-md border ${bgColor} ${borderColor} ${textColor} mb-4`}
    >
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        <p className="text-sm">{message.message}</p>
      </div>
    </div>
  );
};

const validateOAuthMetadata = async (
  provider: DebugInspectorOAuthClientProvider,
): Promise<OAuthMetadata> => {
  const metadata = provider.getServerMetadata();
  if (metadata) {
    return metadata;
  }

  const fetchedMetadata = await discoverOAuthMetadata(provider.serverUrl);
  if (!fetchedMetadata) {
    throw new Error("Failed to discover OAuth metadata");
  }
  const parsedMetadata = await OAuthMetadataSchema.parseAsync(fetchedMetadata);

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

const AuthDebugger = ({
  serverUrl: serverUrl,
  onBack,
  authState,
  updateAuthState,
}: AuthDebuggerProps) => {
  // Load client info asynchronously when we're at the token_request step

  const startOAuthFlow = useCallback(() => {
    if (!serverUrl) {
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
  }, [serverUrl, updateAuthState]);

  const proceedToNextStep = useCallback(async () => {
    if (!serverUrl) return;
    const provider = new DebugInspectorOAuthClientProvider(serverUrl);

    try {
      updateAuthState({
        isInitiatingAuth: true,
        statusMessage: null,
        latestError: null,
      });

      if (authState.oauthStep === "not_started") {
        updateAuthState({ oauthStep: "metadata_discovery" });
        const metadata = await discoverOAuthMetadata(serverUrl);
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

        const fullInformation = await registerClient(serverUrl, {
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
          let scope: string | undefined = undefined;
          if (metadata.scopes_supported) {
            // Request all supported scopes during debugging
            scope = metadata.scopes_supported.join(" ");
          }
          const { authorizationUrl, codeVerifier } = await startAuthorization(
            serverUrl,
            {
              metadata,
              clientInformation,
              redirectUrl: provider.redirectUrl,
              scope,
            },
          );

          provider.saveCodeVerifier(codeVerifier);

          updateAuthState({
            authorizationUrl: authorizationUrl.toString(),
            oauthStep: "authorization_code",
          });
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

        const tokens = await exchangeAuthorization(serverUrl, {
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
  }, [serverUrl, authState, updateAuthState]);

  const handleStartOAuth = useCallback(async () => {
    if (!serverUrl) {
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
      const serverAuthProvider = new DebugInspectorOAuthClientProvider(
        serverUrl,
      );
      await auth(serverAuthProvider, { serverUrl: serverUrl });
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
  }, [serverUrl, updateAuthState]);

  const handleClearOAuth = useCallback(() => {
    if (serverUrl) {
      const serverAuthProvider = new DebugInspectorOAuthClientProvider(
        serverUrl,
      );
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
  }, [serverUrl, updateAuthState]);

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

              {authState.statusMessage && (
                <StatusMessage message={authState.statusMessage} />
              )}

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

            <OAuthFlowProgress
              serverUrl={serverUrl}
              authState={authState}
              updateAuthState={updateAuthState}
              proceedToNextStep={proceedToNextStep}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthDebugger;
