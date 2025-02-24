import { useEffect, useRef } from "react";
import { authProvider } from "../lib/auth";
import { SESSION_KEYS } from "../lib/constants";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

const OAuthCallback = () => {
  const hasProcessedRef = useRef(false);

  useEffect(() => {
    const handleCallback = async () => {
      // Skip if we've already processed this callback
      if (hasProcessedRef.current) {
        return;
      }
      hasProcessedRef.current = true;

      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const serverUrl = sessionStorage.getItem(SESSION_KEYS.SERVER_URL);

      if (!code || !serverUrl) {
        console.error("Missing code or server URL");
        window.location.href = "/";
        return;
      }

      try {
        const result = await auth(authProvider, {
          serverUrl,
          authorizationCode: code,
        });
        if (result !== "AUTHORIZED") {
          throw new Error(
            `Expected to be authorized after providing auth code, got: ${result}`,
          );
        }

        // Redirect back to the main app with server URL to trigger auto-connect
        window.location.href = `/?serverUrl=${encodeURIComponent(serverUrl)}`;
      } catch (error) {
        console.error("OAuth callback error:", error);
        window.location.href = "/";
      }
    };

    void handleCallback();
  }, []);

  return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-lg text-gray-500">Processing OAuth callback...</p>
    </div>
  );
};

export default OAuthCallback;
