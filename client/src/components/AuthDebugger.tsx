import { useCallback, useMemo, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DebugInspectorOAuthClientProvider,
  clearClientInformationFromSessionStorage,
} from "../lib/auth";
import { AlertCircle } from "lucide-react";
import { AuthDebuggerState, EMPTY_DEBUGGER_STATE } from "../lib/auth-types";
import { OAuthFlowProgress } from "./OAuthFlowProgress";
import { OAuthStateMachine } from "../lib/oauth-state-machine";
import { SESSION_KEYS } from "../lib/constants";
import { validateRedirectUrl } from "@/utils/urlValidation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";

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
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearDcrClient, setClearDcrClient] = useState(false);

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

    // Clear cached DCR client info so Step 2 performs a fresh registration
    clearClientInformationFromSessionStorage({
      serverUrl,
      isPreregistered: false,
    });

    updateAuthState({
      oauthStep: "metadata_discovery",
      oauthClientInfo: null,
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
      // Step through the OAuth flow using the state machine instead of the auth() function
      let currentState: AuthDebuggerState = {
        ...authState,
        oauthStep: "metadata_discovery",
        authorizationUrl: null,
        latestError: null,
      };

      const oauthMachine = new OAuthStateMachine(serverUrl, (updates) => {
        // Update our temporary state during the process
        currentState = { ...currentState, ...updates };
        // But don't call updateAuthState yet
      });

      // Manually step through each stage of the OAuth flow
      while (currentState.oauthStep !== "complete") {
        await oauthMachine.executeStep(currentState);
        // In quick mode, we'll just redirect to the authorization URL
        if (
          currentState.oauthStep === "authorization_code" &&
          currentState.authorizationUrl
        ) {
          // Validate the URL before redirecting
          try {
            validateRedirectUrl(currentState.authorizationUrl);
          } catch (error) {
            updateAuthState({
              ...currentState,
              isInitiatingAuth: false,
              latestError:
                error instanceof Error ? error : new Error(String(error)),
              statusMessage: {
                type: "error",
                message: `Invalid authorization URL: ${error instanceof Error ? error.message : String(error)}`,
              },
            });
            return;
          }

          // Store the current auth state before redirecting
          sessionStorage.setItem(
            SESSION_KEYS.AUTH_DEBUGGER_STATE,
            JSON.stringify(currentState),
          );
          // Open the authorization URL automatically
          window.location.href = currentState.authorizationUrl.toString();
          break;
        }
      }

      // After the flow completes or reaches a user-input step, update the app state
      updateAuthState({
        ...currentState,
        statusMessage: {
          type: "info",
          message:
            currentState.oauthStep === "complete"
              ? "Authentication completed successfully"
              : "Please complete authentication in the opened window and enter the code",
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
  }, [serverUrl, updateAuthState, authState]);

  const handleClearOAuth = useCallback(
    (alsoClearDcrClient: boolean) => {
      if (serverUrl) {
        const serverAuthProvider = new DebugInspectorOAuthClientProvider(
          serverUrl,
        );
        serverAuthProvider.clear();

        if (alsoClearDcrClient) {
          clearClientInformationFromSessionStorage({
            serverUrl,
            isPreregistered: false,
          });
        }

        updateAuthState({
          ...EMPTY_DEBUGGER_STATE,
          oauthClientInfo: alsoClearDcrClient
            ? null
            : EMPTY_DEBUGGER_STATE.oauthClientInfo,
          statusMessage: {
            type: "success",
            message: alsoClearDcrClient
              ? "OAuth tokens and client registration cleared successfully"
              : "OAuth tokens cleared successfully",
          },
        });

        // Clear success message after 3 seconds
        setTimeout(() => {
          updateAuthState({ statusMessage: null });
        }, 3000);
      }
    },
    [serverUrl, updateAuthState],
  );

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

                  <Button
                    variant="outline"
                    onClick={() => {
                      setClearDcrClient(false);
                      setClearDialogOpen(true);
                    }}
                  >
                    Clear OAuth State
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Choose "Guided" for step-by-step instructions or "Quick" for
                  the standard automatic flow.
                </p>
              </div>
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

      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear OAuth State</DialogTitle>
            <DialogDescription>
              This will clear OAuth tokens, code verifier, and server metadata
              for this session.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start space-x-2 py-2">
            <Checkbox
              id="clear-dcr-client"
              checked={clearDcrClient}
              onCheckedChange={(checked) => setClearDcrClient(checked === true)}
            />
            <div className="grid gap-1.5 leading-none">
              <label
                htmlFor="clear-dcr-client"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Also clear registered client information
              </label>
              <p className="text-xs text-muted-foreground">
                The server will need to re-register this client on the next
                OAuth flow.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                handleClearOAuth(clearDcrClient);
                setClearDialogOpen(false);
              }}
            >
              Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AuthDebugger;
