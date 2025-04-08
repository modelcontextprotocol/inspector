import { InspectorConfig } from "./configurationTypes";

// OAuth-related session storage keys
export const SESSION_KEYS = {
  CODE_VERIFIER: "mcp_code_verifier",
  SERVER_URL: "mcp_server_url",
  TOKENS: "mcp_tokens",
  CLIENT_INFORMATION: "mcp_client_information",
} as const;

export type ConnectionStatus =
  | "disconnected"
  | "connected"
  | "error"
  | "error-connecting-to-proxy";

export const DEFAULT_MCP_PROXY_LISTEN_PORT = "6277";

/**
 * Default configuration for the MCP Inspector, Currently persisted in local_storage in the Browser.
 * Future plans: Provide json config file + Browser local_storage to override default values
 **/
export const DEFAULT_INSPECTOR_CONFIG: InspectorConfig = {
  MCP_SERVER_REQUEST_TIMEOUT: {
    description: "Request Timeout",
    value: 10000,
  },
  MCP_REQUEST_TIMEOUT_RESET_ON_PROGRESS: {
    description: "Reset Timeout on Progress",
    value: true,
  },
  MCP_REQUEST_MAX_TOTAL_TIMEOUT: {
    description: "Maximum Total Timeout",
    value: 60000,
  },
  MCP_PROXY_FULL_ADDRESS: {
    description: "Inspector Proxy Address",
    value: "",
  },
} as const;
