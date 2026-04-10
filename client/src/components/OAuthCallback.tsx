import { useEffect, useRef } from "react";
import { InspectorOAuthClientProvider } from "../lib/auth";
import { SESSION_KEYS } from "../lib/constants";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthTokensSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { useToast } from "@/lib/hooks/useToast";
import {
  generateOAuthErrorDescription,
  parseOAuthCallbackParams,
} from "@/utils/oauthUtils.ts";
import {
  getMCPProxyAddress,
  getMCPProxyAuthToken,
  initializeInspectorConfig,
} from "@/utils/configUtils";

const CONFIG_LOCAL_STORAGE_KEY = "inspectorConfig_v1";

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

      const authMethod = localStorage.getItem("lastOauthAuthMethod");

      if (authMethod === "certificate") {
        // Certificate-based token exchange via server proxy
        try {
          const clientId = localStorage.getItem("lastOauthClientId") || "";
          const certPath = localStorage.getItem("lastOauthCertPath") || "";
          const keyPath = localStorage.getItem("lastOauthKeyPath") || "";
          const tokenEndpointUrl =
            localStorage.getItem("lastOauthTokenEndpoint") || "";
          const scope = localStorage.getItem("lastOauthScope") || "";

          // Validate required fields before sending
          const missingFields: string[] = [];
          if (!clientId) missingFields.push("Client ID");
          if (!certPath) missingFields.push("Certificate Path");
          if (!keyPath) missingFields.push("Private Key Path");
          if (!tokenEndpointUrl) missingFields.push("Token Endpoint URL");

          if (missingFields.length > 0) {
            return notifyError(
              `Certificate auth configuration incomplete. Missing: ${missingFields.join(", ")}. Please fill in these fields before connecting.`,
            );
          }

          const serverAuthProvider = new InspectorOAuthClientProvider(
            serverUrl,
          );
          let codeVerifier: string | undefined;
          try {
            codeVerifier = serverAuthProvider.codeVerifier();
          } catch {
            // Code verifier may not be available
          }

          const config = initializeInspectorConfig(CONFIG_LOCAL_STORAGE_KEY);
          const proxyAddress = getMCPProxyAddress(config);
          const { token: proxyToken, header: proxyAuthHeader } =
            getMCPProxyAuthToken(config);

          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (proxyToken) {
            headers[proxyAuthHeader] = `Bearer ${proxyToken}`;
          }

          const response = await fetch(
            `${proxyAddress}/oauth/token/certificate`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                clientId,
                tokenEndpointUrl,
                certPath,
                keyPath,
                authorizationCode: params.code,
                redirectUri: window.location.origin + "/oauth/callback",
                codeVerifier,
                scope: scope || undefined,
              }),
            },
          );

          if (!response.ok) {
            const errorData = await response.json();
            return notifyError(
              `Certificate token exchange failed: ${errorData.message || errorData.error || response.statusText}`,
            );
          }

          const tokenData = await response.json();
          const tokens = await OAuthTokensSchema.parseAsync(tokenData);
          serverAuthProvider.saveTokens(tokens);

          toast({
            title: "Success",
            description:
              "Successfully authenticated with OAuth (certificate auth)",
            variant: "default",
          });
          onConnect(serverUrl);
        } catch (error) {
          console.error("Certificate OAuth callback error:", error);
          return notifyError(`Certificate auth error: ${error}`);
        }
      } else {
        // Standard flow using SDK's auth()
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

        toast({
          title: "Success",
          description: "Successfully authenticated with OAuth",
          variant: "default",
        });
        onConnect(serverUrl);
      }
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
