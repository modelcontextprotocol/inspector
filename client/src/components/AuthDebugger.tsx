import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DebugInspectorOAuthClientProvider } from "../lib/auth";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { AuthDebuggerState, EMPTY_DEBUGGER_STATE } from "../lib/auth-types";
import { AuthDebuggerFlow } from "./AuthDebuggerFlow";
import { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

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
  let Icon = AlertCircle;

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
      Icon = CheckCircle2;
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
        <Icon className="h-4 w-4" />
        <p className="text-sm">{message.message}</p>
      </div>
    </div>
  );
};

const AuthDebugger = ({
  serverUrl,
  onBack,
  authState,
  updateAuthState,
}: AuthDebuggerProps) => {
  const [flowMode, setFlowMode] = useState<"debug" | "quick" | null>(null);
  const [flowComplete, setFlowComplete] = useState(false);

  // Check for existing tokens on mount
  useEffect(() => {
    if (serverUrl && !authState.oauthTokens) {
      const checkTokens = async () => {
        try {
          const provider = new DebugInspectorOAuthClientProvider(serverUrl);
          const existingTokens = await provider.tokens();
          if (existingTokens) {
            updateAuthState({
              oauthTokens: existingTokens,
              oauthStep: "complete",
            });
          }
        } catch (error) {
          console.error("Failed to load existing OAuth tokens:", error);
        }
      };
      checkTokens();
    }
  }, [serverUrl, updateAuthState, authState.oauthTokens]);

  const startFlow = useCallback(
    (mode: "debug" | "quick") => {
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
        statusMessage: null,
        latestError: null,
      });
      setFlowComplete(false);
      setFlowMode(mode);
    },
    [serverUrl, updateAuthState],
  );

  const startRunFlow = useCallback(() => startFlow("quick"), [startFlow]);
  const startSlowFlow = useCallback(() => startFlow("debug"), [startFlow]);

  const handleFlowComplete = useCallback(
    (tokens: OAuthTokens) => {
      updateAuthState({
        oauthTokens: tokens,
        oauthStep: "complete",
      });
      // Keep the flow visible but mark as complete
      setFlowComplete(true);
    },
    [updateAuthState],
  );

  const handleFlowCancel = useCallback(() => {
    setFlowMode(null);
    setFlowComplete(false);
    updateAuthState({
      statusMessage: {
        type: "info",
        message: "OAuth flow cancelled",
      },
    });
  }, [updateAuthState]);

  const handleFlowError = useCallback(
    (error: Error) => {
      setFlowMode(null);
      setFlowComplete(false);
      updateAuthState({
        latestError: error,
        statusMessage: {
          type: "error",
          message: `OAuth flow failed: ${error.message}`,
        },
      });
    },
    [updateAuthState],
  );

  const handleClearOAuth = useCallback(() => {
    if (serverUrl) {
      const serverAuthProvider = new DebugInspectorOAuthClientProvider(
        serverUrl,
      );
      serverAuthProvider.clear();
      updateAuthState({
        ...EMPTY_DEBUGGER_STATE,
        statusMessage: {
          type: "success",
          message: "OAuth tokens cleared successfully",
        },
      });
      setFlowMode(null);
      setFlowComplete(false);

      // Clear success message after 3 seconds
      setTimeout(() => {
        updateAuthState({ statusMessage: null });
      }, 3000);
    }
  }, [serverUrl, updateAuthState]);

  const handleNewFlow = useCallback(() => {
    setFlowMode(null);
    setFlowComplete(false);
  }, []);

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

              <div className="space-y-4">
                {authState.oauthTokens && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Access Token:</p>
                    <div className="bg-muted p-2 rounded-md text-xs overflow-x-auto">
                      {authState.oauthTokens.access_token.substring(0, 25)}...
                    </div>
                  </div>
                )}

                <div className="flex gap-4 flex-wrap">
                  <Button
                    onClick={startRunFlow}
                    disabled={flowMode !== null && !flowComplete}
                  >
                    {flowComplete ? "Run Again" : "Run Flow"}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={startSlowFlow}
                    disabled={flowMode !== null && !flowComplete}
                  >
                    Slow Mo
                  </Button>

                  <Button variant="outline" onClick={handleClearOAuth}>
                    Clear OAuth State
                  </Button>

                  {flowComplete && (
                    <Button variant="ghost" onClick={handleNewFlow}>
                      Close
                    </Button>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  <strong>Run Flow</strong>: Run the entire OAuth flow
                  automatically. <strong>Slow Mo</strong>: Step through each
                  request one at a time.
                </p>
              </div>
            </div>

            {flowMode && (
              <AuthDebuggerFlow
                serverUrl={serverUrl}
                quickMode={flowMode === "quick"}
                onComplete={handleFlowComplete}
                onCancel={handleFlowCancel}
                onError={handleFlowError}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthDebugger;
