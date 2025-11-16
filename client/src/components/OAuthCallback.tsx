import { useEffect, useRef } from "react";
import { InspectorOAuthClientProvider } from "../lib/auth";
import { SESSION_KEYS } from "../lib/constants";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { useToast } from "@/lib/hooks/useToast";
import {
  generateOAuthErrorDescription,
  parseOAuthCallbackParams,
} from "@/utils/oauthUtils.ts";
import { createOAuthProviderForServer } from "../lib/oauth/provider-factory";
import { OAuthStateMachine } from "../lib/oauth-state-machine";
import { AuthDebuggerState } from "../lib/auth-types";
import {
  getMCPProxyAddress,
  getMCPProxyAuthToken,
  initializeInspectorConfig,
} from "@/utils/configUtils";

interface OAuthCallbackProps {
  onConnect: (serverUrl: string) => void;
}

const OAuthCallback = ({ onConnect }: OAuthCallbackProps) => {
  const { toast } = useToast();
  const hasProcessedRef = useRef(false);

  useEffect(() => {
    const handleCallback = async () => {
      // Skip if we've already processed this callback
      if (hasProcessedRef.current) {
        return;
      }
      hasProcessedRef.current = true;

      const notifyError = (description: string) =>
        void toast({
          title: "OAuth Authorization Error",
          description,
          variant: "destructive",
        });

      const params = parseOAuthCallbackParams(window.location.search);
      if (!params.successful) {
        return notifyError(generateOAuthErrorDescription(params));
      }

      const serverUrl = sessionStorage.getItem(SESSION_KEYS.SERVER_URL);
      if (!serverUrl) {
        return notifyError("Missing Server URL");
      }

      // Check if there's stored auth state (for proxy mode from Connect button)
      const storedAuthState = sessionStorage.getItem(
        SESSION_KEYS.AUTH_STATE_FOR_CONNECT,
      );

      if (storedAuthState) {
        // Proxy mode: Complete the OAuth flow using the state machine
        try {
          let restoredState: AuthDebuggerState = JSON.parse(storedAuthState);

          // Restore URL objects
          if (
            restoredState.resource &&
            typeof restoredState.resource === "string"
          ) {
            restoredState.resource = new URL(restoredState.resource);
          }
          if (
            restoredState.authorizationUrl &&
            typeof restoredState.authorizationUrl === "string"
          ) {
            restoredState.authorizationUrl = new URL(
              restoredState.authorizationUrl,
            );
          }

          // Set up state with the authorization code
          let currentState: AuthDebuggerState = {
            ...restoredState,
            authorizationCode: params.code,
            oauthStep: "token_request",
          };

          // Get config and create provider
          // Use the same config key and initialization as App.tsx
          const config = initializeInspectorConfig("inspectorConfig_v1");

          const proxyAddress = getMCPProxyAddress(config);
          const proxyAuthObj = getMCPProxyAuthToken(config);

          const oauthProvider = createOAuthProviderForServer(
            serverUrl,
            proxyAddress,
            proxyAuthObj.token,
          );

          const stateMachine = new OAuthStateMachine(
            serverUrl,
            (updates) => {
              currentState = { ...currentState, ...updates };
            },
            oauthProvider,
            false, // use regular redirect URL
          );

          // Complete the token exchange
          await stateMachine.executeStep(currentState);

          if (currentState.oauthStep !== "complete") {
            return notifyError("Failed to complete OAuth token exchange");
          }

          // Clean up stored state
          sessionStorage.removeItem(SESSION_KEYS.AUTH_STATE_FOR_CONNECT);
        } catch (error) {
          console.error("Proxy OAuth callback error:", error);
          sessionStorage.removeItem(SESSION_KEYS.AUTH_STATE_FOR_CONNECT);
          return notifyError(`Failed to complete proxy OAuth: ${error}`);
        }
      } else {
        // Direct mode: Use SDK's auth() function
        let result;
        try {
          const serverAuthProvider = new InspectorOAuthClientProvider(
            serverUrl,
          );

          result = await auth(serverAuthProvider, {
            serverUrl,
            authorizationCode: params.code,
          });
        } catch (error) {
          console.error("OAuth callback error:", error);
          return notifyError(`Unexpected error occurred: ${error}`);
        }

        if (result !== "AUTHORIZED") {
          return notifyError(
            `Expected to be authorized after providing auth code, got: ${result}`,
          );
        }
      }

      // Finally, trigger auto-connect
      toast({
        title: "Success",
        description: "Successfully authenticated with OAuth",
        variant: "default",
      });
      onConnect(serverUrl);
    };

    handleCallback().finally(() => {
      window.history.replaceState({}, document.title, "/");
    });
  }, [toast, onConnect]);

  return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-lg text-gray-500">Processing OAuth callback...</p>
    </div>
  );
};

export default OAuthCallback;
