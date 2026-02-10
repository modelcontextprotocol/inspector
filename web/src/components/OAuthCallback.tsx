import { useEffect, useRef } from "react";
import type { InspectorClient } from "@modelcontextprotocol/inspector-shared/mcp/index.js";
import { parseOAuthState } from "@modelcontextprotocol/inspector-shared/auth/index.js";
import { useToast } from "@/lib/hooks/useToast";
import {
  generateOAuthErrorDescription,
  parseOAuthCallbackParams,
} from "@/utils/oauthUtils.ts";

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
          console.log(
            "[OAuthCallback] Guided mode, no client available - showing code for manual copy",
            { code: params.code.substring(0, 10) + "..." },
          );
          return;
        }
        // Even without a code yet, don't try to create a client in guided mode without one
        // Return early to avoid calling ensureInspectorClient() which would show a toast
        console.log(
          "[OAuthCallback] Guided mode, no client available - skipping client creation",
        );
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

          // Trigger auto-connect
          await client.connect();
          onConnect();
          // Redirect to root after connecting
          window.history.replaceState({}, document.title, "/");
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

  // Log current URL state for debugging
  console.log("[OAuthCallback] Render state:", {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    fullUrl: window.location.href,
    hasCode,
    isGuidedMode,
    parsedState,
    inspectorClient: !!inspectorClient,
  });

  // If guided mode and no client, show code for manual copying
  // Check both /oauth/callback and / paths (in case redirect happened)
  // Don't call ensureInspectorClient() here - it will fail in new tab and cause loops
  const isCallbackPath =
    window.location.pathname === "/oauth/callback" ||
    window.location.pathname === "/";
  if (isCallbackPath && isGuidedMode && !inspectorClient && hasCode) {
    // In new tab scenario, inspectorClient prop will be null
    // Just show the code without trying to create a client
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="mt-4 p-4 bg-secondary rounded-md max-w-md">
          <p className="mb-2 text-sm">
            Please copy this authorization code and return to the Guided Auth
            flow:
          </p>
          <code className="block p-2 bg-muted rounded-sm overflow-x-auto text-xs">
            {params.code}
          </code>
          <p className="mt-4 text-xs text-muted-foreground">
            Close this tab and paste the code in the OAuth flow to complete
            authentication.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-lg text-gray-500">Processing OAuth callback...</p>
    </div>
  );
};

export default OAuthCallback;
