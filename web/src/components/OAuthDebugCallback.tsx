import { useEffect } from "react";
import type { InspectorClient } from "@modelcontextprotocol/inspector-shared/mcp/index.js";
import { parseOAuthCallbackParams } from "@/utils/oauthUtils.ts";

interface OAuthDebugCallbackProps {
  inspectorClient: InspectorClient | null;
  ensureInspectorClient: () => InspectorClient | null;
  onConnect: () => void;
}

const OAuthDebugCallback = ({
  inspectorClient,
  ensureInspectorClient,
  onConnect,
}: OAuthDebugCallbackProps) => {
  useEffect(() => {
    let isProcessed = false;

    const handleCallback = async () => {
      if (isProcessed) return;
      isProcessed = true;

      // Ensure InspectorClient exists (it might not exist if page was refreshed)
      const client = inspectorClient || ensureInspectorClient();
      if (!client) {
        console.error("OAuth debug callback: InspectorClient not available");
        return;
      }

      const params = parseOAuthCallbackParams(window.location.search);
      if (!params.successful || !params.code) {
        // Display error in UI (already handled by component rendering)
        return;
      }

      // For debug flow, we still need to complete the flow manually
      // The guided flow state is managed by InspectorClient internally
      try {
        await client.completeOAuthFlow(params.code);
        onConnect();
      } catch (error) {
        console.error("OAuth debug callback error:", error);
      }
    };

    handleCallback().finally(() => {
      if (window.location.pathname !== "/oauth/callback/debug") {
        window.history.replaceState({}, document.title, "/");
      }
    });

    return () => {
      isProcessed = true;
    };
  }, [inspectorClient, ensureInspectorClient, onConnect]);

  const callbackParams = parseOAuthCallbackParams(window.location.search);

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="mt-4 p-4 bg-secondary rounded-md max-w-md">
        <p className="mb-2 text-sm">
          Please copy this authorization code and return to the Auth Debugger:
        </p>
        <code className="block p-2 bg-muted rounded-sm overflow-x-auto text-xs">
          {callbackParams.successful && "code" in callbackParams
            ? callbackParams.code
            : `No code found: ${callbackParams.error}, ${callbackParams.error_description}`}
        </code>
        <p className="mt-4 text-xs text-muted-foreground">
          Close this tab and paste the code in the OAuth flow to complete
          authentication.
        </p>
      </div>
    </div>
  );
};

export default OAuthDebugCallback;
