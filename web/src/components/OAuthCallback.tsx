import { useCallback, useEffect, useRef, useState } from "react";
import type { InspectorClient } from "@modelcontextprotocol/inspector-shared/mcp/index.js";
import { parseOAuthState } from "@modelcontextprotocol/inspector-shared/auth/index.js";
import useTheme from "@/lib/hooks/useTheme";
import { useToast } from "@/lib/hooks/useToast";
import {
  generateOAuthErrorDescription,
  parseOAuthCallbackParams,
} from "@/utils/oauthUtils.ts";
import { Button } from "@/components/ui/button";
import { Check, Copy, KeyRound } from "lucide-react";

function GuidedAuthCodeDisplay({
  code,
  toast,
}: {
  code: string;
  toast: (opts: {
    title: string;
    description?: string;
    variant?: "default" | "destructive";
  }) => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Copy failed",
        description: "Could not copy to clipboard",
        variant: "destructive",
      });
    }
  }, [code, toast]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-[42rem] rounded-lg border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-col items-center gap-6">
          <div className="flex items-center gap-3">
            <KeyRound className="h-10 w-10 text-muted-foreground" />
            <h1 className="text-2xl font-semibold text-foreground">
              MCP Inspector
            </h1>
          </div>
          <p className="text-sm text-muted-foreground text-center">
            Please copy this authorization code and return to the Guided Auth
            flow:
          </p>
          <div className="w-full flex items-center gap-2">
            <code className="block flex-1 min-w-0 p-2 bg-muted rounded-sm overflow-x-auto text-xs text-foreground font-mono">
              {code}
            </code>
            <div className="flex items-center gap-2 flex-shrink-0">
              {copied && (
                <span className="text-xs text-muted-foreground">Copied!</span>
              )}
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopy}
                aria-label="Copy code"
                title="Copy to clipboard"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Close this tab and paste the code in the OAuth flow to complete
            authentication.
          </p>
        </div>
      </div>
    </div>
  );
}

interface OAuthCallbackProps {
  inspectorClient: InspectorClient | null;
  ensureInspectorClient: () => InspectorClient | null;
  onConnect: () => void;
}

const OAuthCallback = ({
  inspectorClient,
  ensureInspectorClient,
  onConnect,
}: OAuthCallbackProps) => {
  useTheme(); // Apply saved theme to document so standalone (e.g. new-tab) callback obeys theme
  const { toast } = useToast();
  const hasProcessedRef = useRef(false);

  useEffect(() => {
    const handleCallback = async () => {
      if (hasProcessedRef.current) return;
      hasProcessedRef.current = true;

      // Parse params first to check if this is guided mode with no client
      const params = parseOAuthCallbackParams(window.location.search);
      const urlParams = new URLSearchParams(window.location.search);
      const stateParam = urlParams.get("state");
      const parsedState = stateParam ? parseOAuthState(stateParam) : null;
      const isGuidedMode = parsedState?.mode === "guided";

      // If guided mode and no client available (new tab scenario), don't process, just display
      // Skip ensureInspectorClient() here to avoid showing "API token required" toast
      // since we're going to show the code for manual copying anyway
      if (isGuidedMode && !inspectorClient) {
        // If we have a code, store it and return early
        if (params.successful && params.code) {
          // Store code in sessionStorage for potential auto-fill (future enhancement)
          if (parsedState?.authId) {
            sessionStorage.setItem(
              `oauth_guided_code_${parsedState.authId}`,
              params.code,
            );
          }
          // Don't redirect - let the component render the code display
          return;
        }
        // Even without a code yet, don't try to create a client in guided mode without one
        return;
      }

      // Ensure InspectorClient exists (it might not exist if page was refreshed)
      // At this point, we're either not in guided mode, or we're in guided mode WITH a client
      const client = inspectorClient || ensureInspectorClient();

      // Log to InspectorClient's logger if available (persists through redirects)
      const clientLogger = client ? (client as any).logger : null;
      if (clientLogger) {
        clientLogger.info(
          {
            component: "OAuthCallback",
            action: "callback_received",
            pathname: window.location.pathname,
            search: window.location.search,
            hash: window.location.hash,
            fullUrl: window.location.href,
            expectedPathname: "/oauth/callback",
          },
          "OAuth callback handler invoked",
        );
      }
      const notifyError = (description: string) =>
        void toast({
          title: "OAuth Authorization Error",
          description,
          variant: "destructive",
        });

      if (clientLogger) {
        clientLogger.info(
          {
            component: "OAuthCallback",
            action: "parse_params",
            successful: params.successful,
            hasCode:
              params.successful && "code" in params ? !!params.code : false,
            hasState: !!stateParam,
            state: stateParam,
            error: params.successful ? null : params.error,
            errorDescription: params.successful
              ? null
              : params.error_description,
          },
          "Parsed OAuth callback parameters",
        );
      }

      if (!params.successful) {
        if (clientLogger) {
          clientLogger.error(
            {
              component: "OAuthCallback",
              action: "callback_error",
              error: params.error,
              errorDescription: params.error_description,
            },
            "OAuth callback parameters indicate failure",
          );
        }
        return notifyError(generateOAuthErrorDescription(params));
      }

      if (!params.code) {
        return notifyError("Missing authorization code");
      }

      if (clientLogger) {
        clientLogger.info(
          {
            component: "OAuthCallback",
            action: "detect_mode",
            parsedState,
            isGuidedMode,
            hasClient: !!client,
            currentOAuthStep: client?.getOAuthStep(),
          },
          "Detected OAuth flow mode",
        );
      }

      // If no client and not guided mode, show error
      if (!client) {
        toast({
          title: "Error",
          description:
            "InspectorClient is not available. Please ensure API token is set and try connecting again.",
          variant: "destructive",
        });
        return;
      }

      try {
        if (isGuidedMode) {
          // Guided mode: set authorization code without proceeding
          // User will click "Next" in Auth Debugger to proceed
          const currentStep = client.getOAuthStep();
          if (currentStep !== "authorization_code") {
            if (clientLogger) {
              clientLogger.warn(
                {
                  component: "OAuthCallback",
                  action: "unexpected_step",
                  currentStep,
                  expectedStep: "authorization_code",
                },
                "Received authorization code but not at authorization_code step",
              );
            }
            return notifyError(
              `Unexpected OAuth step: ${currentStep}. Expected: authorization_code`,
            );
          }

          await client.setGuidedAuthorizationCode(params.code, false);

          if (clientLogger) {
            clientLogger.info(
              {
                component: "OAuthCallback",
                action: "code_set_for_guided",
              },
              "Authorization code set for guided flow. User should proceed manually.",
            );
          }

          toast({
            title: "Authorization Code Received",
            description:
              "Return to the Auth Debugger and click 'Next' to continue.",
            variant: "default",
          });

          // Don't redirect in guided mode - user needs to see the code or return manually
          // Don't auto-connect in guided mode - user controls progression
        } else {
          // Normal mode: complete the flow automatically
          await client.completeOAuthFlow(params.code);

          toast({
            title: "Success",
            description: "Successfully authenticated with OAuth",
            variant: "default",
          });

          // Connect first, then navigate. If we navigate first we lose the callback URL
          // (state param with sessionId), so a retry or connect from main page wouldn't restore session.
          await client.connect();
          onConnect();
          const targetPath = "/" + (window.location.hash || "");
          window.history.replaceState({}, document.title, targetPath);
        }
      } catch (error) {
        console.error("OAuth callback error:", error);
        if (clientLogger) {
          clientLogger.error(
            {
              component: "OAuthCallback",
              action: "callback_error",
              error: error instanceof Error ? error.message : String(error),
            },
            "OAuth callback processing failed",
          );
        }
        return notifyError(
          `OAuth flow failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    handleCallback();
  }, [inspectorClient, ensureInspectorClient, toast, onConnect]);

  // Extract state and code for display (for rendering before useEffect runs)
  const urlParams = new URLSearchParams(window.location.search);
  const stateParam = urlParams.get("state");
  const parsedState = stateParam ? parseOAuthState(stateParam) : null;
  const isGuidedMode = parsedState?.mode === "guided";
  const params = parseOAuthCallbackParams(window.location.search);
  const hasCode = params.successful && "code" in params && !!params.code;

  // If guided mode and no client, show code for manual copying
  // Check both /oauth/callback and / paths (in case redirect happened)
  // Don't call ensureInspectorClient() here - it will fail in new tab and cause loops
  const isCallbackPath =
    window.location.pathname === "/oauth/callback" ||
    window.location.pathname === "/";
  if (isCallbackPath && isGuidedMode && !inspectorClient && hasCode) {
    return <GuidedAuthCodeDisplay code={params.code} toast={toast} />;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <p className="text-lg text-muted-foreground">
        Processing OAuth callback...
      </p>
    </div>
  );
};

export default OAuthCallback;
