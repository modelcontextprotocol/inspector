import { useCallback, useMemo, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DebugInspectorOAuthClientProvider } from "../lib/auth";
import { AlertCircle } from "lucide-react";
import { AuthDebuggerState, EMPTY_DEBUGGER_STATE } from "../lib/auth-types";
import { OAuthFlowProgress } from "./OAuthFlowProgress";
import { OAuthStateMachine } from "../lib/oauth-state-machine";
import { createProxyFetch } from "../lib/proxyFetch";
import { SESSION_KEYS } from "../lib/constants";
import { validateRedirectUrl } from "@/utils/urlValidation";
import type { InspectorConfig } from "../lib/configurationTypes";
import { exchangeClientCredentials } from "../lib/clientCredentialsAuth";

export interface AuthDebuggerProps {
  serverUrl: string;
  onBack: () => void;
  authState: AuthDebuggerState;
  updateAuthState: (updates: Partial<AuthDebuggerState>) => void;
  config?: InspectorConfig;
  connectionType?: "direct" | "proxy";
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
  config,
  connectionType,
}: AuthDebuggerProps) => {
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

    updateAuthState({
      oauthStep: "metadata_discovery",
      authorizationUrl: null,
      statusMessage: null,
      latestError: null,
    });
  }, [serverUrl, updateAuthState]);

  const fetchFn = useMemo(
    () =>
      connectionType === "proxy" && config
        ? createProxyFetch(config)
        : undefined,
    [connectionType, config],
  );

  const stateMachine = useMemo(
    () => new OAuthStateMachine(serverUrl, updateAuthState, fetchFn),
    [serverUrl, updateAuthState, fetchFn],
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

      const oauthMachine = new OAuthStateMachine(
        serverUrl,
        (updates) => {
          // Update our temporary state during the process
          currentState = { ...currentState, ...updates };
          // But don't call updateAuthState yet
        },
        fetchFn,
      );

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
  }, [serverUrl, updateAuthState, authState, fetchFn]);

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

      // Clear success message after 3 seconds
      setTimeout(() => {
        updateAuthState({ statusMessage: null });
      }, 3000);
    }
  }, [serverUrl, updateAuthState]);

  // ----- Client Credentials grant -----
  // Form state is local: this flow is a single token request, not a multi-step
  // state machine, so it doesn't need to live in shared AuthDebuggerState.
  const [ccTokenEndpoint, setCcTokenEndpoint] = useState("");
  const [ccClientId, setCcClientId] = useState("");
  const [ccClientSecret, setCcClientSecret] = useState("");
  const [ccScope, setCcScope] = useState("");
  const [ccAuthMethod, setCcAuthMethod] = useState<"basic" | "body">("basic");

  const handleClientCredentialsExchange = useCallback(async () => {
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

    if (!ccTokenEndpoint || !ccClientId || !ccClientSecret) {
      updateAuthState({
        statusMessage: {
          type: "error",
          message:
            "Token Endpoint, Client ID, and Client Secret are required for client_credentials",
        },
      });
      return;
    }

    updateAuthState({
      isInitiatingAuth: true,
      statusMessage: null,
      latestError: null,
    });

    try {
      const tokens = await exchangeClientCredentials(
        {
          tokenEndpoint: ccTokenEndpoint,
          clientId: ccClientId,
          clientSecret: ccClientSecret,
          scope: ccScope || undefined,
          authMethod: ccAuthMethod,
        },
        fetchFn,
      );

      const provider = new DebugInspectorOAuthClientProvider(serverUrl);
      provider.saveTokens(tokens);

      updateAuthState({
        oauthTokens: tokens,
        oauthStep: "complete",
        statusMessage: {
          type: "success",
          message:
            "Obtained access token via client_credentials grant. It will be used automatically for server requests.",
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      updateAuthState({
        latestError: error instanceof Error ? error : new Error(message),
        statusMessage: {
          type: "error",
          message: `client_credentials flow failed: ${message}`,
        },
      });
    } finally {
      updateAuthState({ isInitiatingAuth: false });
    }
  }, [
    serverUrl,
    ccTokenEndpoint,
    ccClientId,
    ccClientSecret,
    ccScope,
    ccAuthMethod,
    fetchFn,
    updateAuthState,
  ]);

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

              {authState.oauthTokens && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Access Token:</p>
                  <div className="bg-muted p-2 rounded-md text-xs overflow-x-auto">
                    {authState.oauthTokens.access_token.substring(0, 25)}...
                  </div>
                </div>
              )}

              <Tabs defaultValue="authorization_code" className="w-full">
                <TabsList>
                  <TabsTrigger value="authorization_code">
                    Authorization Code
                  </TabsTrigger>
                  <TabsTrigger value="client_credentials">
                    Client Credentials
                  </TabsTrigger>
                </TabsList>

                <TabsContent
                  value="authorization_code"
                  className="space-y-4 pt-4"
                >
                  <div className="flex gap-4 flex-wrap">
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
                </TabsContent>

                <TabsContent
                  value="client_credentials"
                  className="space-y-4 pt-4"
                >
                  <p className="text-sm text-muted-foreground">
                    OAuth 2.0 client_credentials grant. Use this for
                    service-to-service MCP servers (e.g. behind an API gateway)
                    where the inspector is the client.
                  </p>

                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="cc-token-endpoint">
                        Token Endpoint
                      </Label>
                      <Input
                        id="cc-token-endpoint"
                        type="url"
                        autoComplete="off"
                        placeholder="https://auth.example.com/oauth/token"
                        value={ccTokenEndpoint}
                        onChange={(e) => setCcTokenEndpoint(e.target.value)}
                      />
                    </div>

                    <div className="grid gap-1.5">
                      <Label htmlFor="cc-client-id">Client ID</Label>
                      <Input
                        id="cc-client-id"
                        autoComplete="off"
                        value={ccClientId}
                        onChange={(e) => setCcClientId(e.target.value)}
                      />
                    </div>

                    <div className="grid gap-1.5">
                      <Label htmlFor="cc-client-secret">Client Secret</Label>
                      <Input
                        id="cc-client-secret"
                        type="password"
                        autoComplete="off"
                        value={ccClientSecret}
                        onChange={(e) => setCcClientSecret(e.target.value)}
                      />
                    </div>

                    <div className="grid gap-1.5">
                      <Label htmlFor="cc-scope">Scope (optional)</Label>
                      <Input
                        id="cc-scope"
                        autoComplete="off"
                        placeholder="space-separated, e.g. read write"
                        value={ccScope}
                        onChange={(e) => setCcScope(e.target.value)}
                      />
                    </div>

                    <div className="grid gap-1.5">
                      <Label htmlFor="cc-auth-method">
                        Client Authentication
                      </Label>
                      <select
                        id="cc-auth-method"
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={ccAuthMethod}
                        onChange={(e) =>
                          setCcAuthMethod(
                            e.target.value === "body" ? "body" : "basic",
                          )
                        }
                      >
                        <option value="basic">
                          HTTP Basic (Authorization header)
                        </option>
                        <option value="body">
                          Request body (client_id + client_secret)
                        </option>
                      </select>
                      <p className="text-xs text-muted-foreground">
                        Most authorization servers accept Basic. Switch to body
                        if your server requires credentials in the form body.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3 flex-wrap">
                    <Button
                      onClick={handleClientCredentialsExchange}
                      disabled={authState.isInitiatingAuth}
                    >
                      {authState.isInitiatingAuth
                        ? "Requesting token..."
                        : "Request Token"}
                    </Button>

                    <Button variant="outline" onClick={handleClearOAuth}>
                      Clear OAuth State
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
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
