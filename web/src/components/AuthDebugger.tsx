import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import type { InspectorClient } from "@modelcontextprotocol/inspector-shared/mcp/index.js";
import type { AuthGuidedState } from "@modelcontextprotocol/inspector-shared/auth/types.js";
import { OAuthFlowProgress } from "./OAuthFlowProgress";
import { useToast } from "@/lib/hooks/useToast";

export interface AuthDebuggerProps {
  inspectorClient: InspectorClient | null;
  ensureInspectorClient: () => InspectorClient | null;
  canCreateInspectorClient: () => boolean;
  onBack: () => void;
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
  inspectorClient,
  ensureInspectorClient,
  canCreateInspectorClient,
  onBack,
}: AuthDebuggerProps) => {
  const { toast } = useToast();
  const [oauthState, setOauthState] = useState<AuthGuidedState | undefined>(
    undefined,
  );
  const [isInitiatingAuth, setIsInitiatingAuth] = useState(false);

  // Sync oauthState from InspectorClient (TUI pattern)
  useEffect(() => {
    if (!inspectorClient) {
      setOauthState(undefined);
      return;
    }

    const update = () => setOauthState(inspectorClient.getOAuthState());
    update();

    const onStepChange = () => update();
    inspectorClient.addEventListener("oauthStepChange", onStepChange);
    inspectorClient.addEventListener("oauthComplete", onStepChange);
    inspectorClient.addEventListener("oauthError", onStepChange);

    return () => {
      inspectorClient.removeEventListener("oauthStepChange", onStepChange);
      inspectorClient.removeEventListener("oauthComplete", onStepChange);
      inspectorClient.removeEventListener("oauthError", onStepChange);
    };
  }, [inspectorClient]);

  // Check for existing tokens on mount
  useEffect(() => {
    if (inspectorClient && !oauthState?.oauthTokens) {
      inspectorClient.getOAuthTokens().then((tokens) => {
        if (tokens) {
          // State will be updated via getOAuthState() in sync effect
          setOauthState(inspectorClient.getOAuthState());
        }
      });
    }
  }, [inspectorClient, oauthState]);

  const handleQuickOAuth = useCallback(async () => {
    const client = ensureInspectorClient();
    if (!client) {
      return; // Error already shown in ensureInspectorClient
    }

    setIsInitiatingAuth(true);
    try {
      // Quick Auth: normal flow (automatic redirect via BrowserNavigation)
      const authUrl = await client.authenticate();
      // Log to InspectorClient's logger (persists through redirects)
      const clientLogger = (client as any).logger;
      if (clientLogger) {
        clientLogger.info(
          {
            component: "AuthDebugger",
            action: "authenticate",
            authorizationUrl: authUrl.href,
            redirectUri: authUrl.searchParams.get("redirect_uri"),
            expectedRedirectUri: `${window.location.origin}/oauth/callback`,
            currentOrigin: window.location.origin,
            currentPathname: window.location.pathname,
          },
          "OAuth authorization URL generated - about to redirect",
        );
      }
      // Log to console as well (will be lost on redirect but useful for debugging)
      console.log("[AuthDebugger] Authorization URL:", authUrl.href);
      console.log(
        "[AuthDebugger] Redirect URI param:",
        authUrl.searchParams.get("redirect_uri"),
      );
      // BrowserNavigation handles redirect automatically
    } catch (error) {
      console.error("Quick OAuth failed:", error);
      toast({
        title: "OAuth Error",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setIsInitiatingAuth(false);
    }
  }, [ensureInspectorClient, toast]);

  const handleGuidedOAuth = useCallback(async () => {
    const client = ensureInspectorClient();
    if (!client) {
      return; // Error already shown in ensureInspectorClient
    }

    setIsInitiatingAuth(true);
    try {
      // Start guided flow
      await client.beginGuidedAuth();
      // State updates via oauthStepChange events (handled in useEffect above)
    } catch (error) {
      console.error("Guided OAuth start failed:", error);
      toast({
        title: "OAuth Error",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setIsInitiatingAuth(false);
    }
  }, [ensureInspectorClient, toast]);

  const proceedToNextStep = useCallback(async () => {
    const client = ensureInspectorClient();
    if (!client || !oauthState) {
      if (!client) {
        // Error already shown in ensureInspectorClient
        return;
      }
      return; // No oauthState, nothing to proceed
    }

    setIsInitiatingAuth(true);
    try {
      await client.proceedOAuthStep();
      // Note: For guided flow, users manually copy the authorization code.
      // There's a manual button in OAuthFlowProgress to open the URL if needed.
      // Quick auth handles redirects automatically via BrowserNavigation.
    } catch (error) {
      console.error("OAuth step failed:", error);
      toast({
        title: "OAuth Error",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setIsInitiatingAuth(false);
    }
  }, [ensureInspectorClient, oauthState, toast]);

  const handleClearOAuth = useCallback(async () => {
    const client = ensureInspectorClient();
    if (!client) {
      return; // Error already shown in ensureInspectorClient
    }

    try {
      client.clearOAuthTokens();
      toast({
        title: "OAuth Cleared",
        description: "OAuth tokens cleared successfully",
        variant: "default",
      });
    } catch (error) {
      console.error("Clear OAuth failed:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  }, [ensureInspectorClient, toast]);

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

              {oauthState?.latestError && (
                <StatusMessage
                  message={{
                    type: "error",
                    message: oauthState.latestError.message,
                  }}
                />
              )}

              <div className="space-y-4">
                {oauthState?.oauthTokens && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Access Token:</p>
                    <div className="bg-muted p-2 rounded-md text-xs overflow-x-auto">
                      {oauthState.oauthTokens.access_token.substring(0, 25)}...
                    </div>
                  </div>
                )}

                <div className="flex gap-4">
                  <Button
                    variant="outline"
                    onClick={handleGuidedOAuth}
                    disabled={
                      isInitiatingAuth ||
                      (!inspectorClient && !canCreateInspectorClient())
                    }
                  >
                    {oauthState?.oauthTokens
                      ? "Guided Token Refresh"
                      : "Guided OAuth Flow"}
                  </Button>

                  <Button
                    onClick={handleQuickOAuth}
                    disabled={
                      isInitiatingAuth ||
                      (!inspectorClient && !canCreateInspectorClient())
                    }
                  >
                    {isInitiatingAuth
                      ? "Initiating..."
                      : oauthState?.oauthTokens
                        ? "Quick Refresh"
                        : "Quick OAuth Flow"}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={handleClearOAuth}
                    disabled={!inspectorClient && !canCreateInspectorClient()}
                  >
                    Clear OAuth State
                  </Button>
                </div>
                {!inspectorClient && !canCreateInspectorClient() && (
                  <p className="text-sm text-destructive">
                    API Token is required. Please set it in Configuration.
                  </p>
                )}

                <p className="text-xs text-muted-foreground">
                  Choose "Guided" for step-by-step instructions or "Quick" for
                  the standard automatic flow.
                </p>
              </div>
            </div>

            <OAuthFlowProgress
              oauthState={oauthState}
              proceedToNextStep={proceedToNextStep}
              ensureInspectorClient={ensureInspectorClient}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthDebugger;
