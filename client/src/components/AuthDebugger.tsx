import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { DebugInspectorOAuthClientProvider } from "../lib/auth";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { AlertCircle } from "lucide-react";
import { AuthDebuggerState } from "../lib/auth-types";
import { OAuthFlowProgress } from "./OAuthFlowProgress";
import { OAuthStateMachine } from "../lib/oauth-state-machine";

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

const AuthDebugger = ({
  serverUrl: serverUrl,
  onBack,
  authState,
  updateAuthState,
}: AuthDebuggerProps) => {
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
      oauthStep: "metadata_discovery",
      authorizationUrl: null,
      statusMessage: null,
      latestError: null,
    });
  }, [serverUrl, updateAuthState]);

  const stateMachine = useMemo(
    () => new OAuthStateMachine(serverUrl, updateAuthState),
    [serverUrl, updateAuthState],
  );

  const proceedToNextStep = useCallback(async () => {
    if (!serverUrl) return;

    try {
      updateAuthState({
        isInitiatingAuth: true,
        statusMessage: null,
        latestError: null,
      });

      await stateMachine.executeStep(authState);
    } catch (error) {
      console.error("OAuth flow error:", error);
      updateAuthState({
        latestError: error instanceof Error ? error : new Error(String(error)),
      });
    } finally {
      updateAuthState({ isInitiatingAuth: false });
    }
  }, [serverUrl, authState, updateAuthState, stateMachine]);

  const handleQuickOAuth = useCallback(async () => {
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
        oauthStep: "metadata_discovery",
        latestError: null,
        oauthClientInfo: null,
        authorizationCode: "",
        validationError: null,
        oauthMetadata: null,
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
                      onClick={handleQuickOAuth}
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
