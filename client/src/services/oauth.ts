import { OAuthTokensSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { SESSION_KEYS, getServerSpecificKey } from "../lib/constants";
import { AuthDebuggerState } from "../lib/auth-types";
import { MCPJamServerConfig, HttpServerDefinition } from "../lib/serverTypes";
import { SetStateAction } from "react";

export const loadOAuthTokens = async (
  serverUrl: string,
  updateAuthState: (updates: Partial<AuthDebuggerState>) => void,
) => {
  try {
    const key = getServerSpecificKey(SESSION_KEYS.TOKENS, serverUrl);
    const tokens = sessionStorage.getItem(key);
    if (tokens) {
      const parsedTokens = await OAuthTokensSchema.parseAsync(
        JSON.parse(tokens),
      );
      updateAuthState({
        oauthTokens: parsedTokens,
        oauthStep: "complete",
      });
    }
  } catch (error) {
    console.error("Error loading OAuth tokens:", error);
  } finally {
    updateAuthState({ loading: false });
  }
};

export const handleOAuthConnect = (
  serverUrl: string,
  selectedServerName: string,
  setServerConfigs: (
    value: SetStateAction<Record<string, MCPJamServerConfig>>,
  ) => void,
  connect: () => void,
) => {
  setServerConfigs((prev: Record<string, MCPJamServerConfig>) => ({
    ...prev,
    [selectedServerName]: {
      transportType: prev[selectedServerName]?.transportType || "stdio",
      url: new URL(serverUrl),
    } as HttpServerDefinition,
  }));

  void connect();
};

export const handleOAuthDebugConnect = (
  {
    authorizationCode,
    errorMsg,
  }: { authorizationCode?: string; errorMsg?: string },
  updateAuthState: (updates: Partial<AuthDebuggerState>) => void,
) => {
  if (authorizationCode) {
    updateAuthState({
      authorizationCode,
      oauthStep: "token_request",
    });
  }
  if (errorMsg) {
    updateAuthState({
      latestError: new Error(errorMsg),
    });
  }
};
