import { InspectorConfig } from "./configurationTypes";


// OAuth-related session storage keys
export const SESSION_KEYS = {
  CODE_VERIFIER: "mcp_code_verifier",
  SERVER_URL: "mcp_server_url",
  TOKENS: "mcp_tokens",
  CLIENT_INFORMATION: "mcp_client_information",
} as const;

export const DEFAULT_INSPECTOR_CONFIG: InspectorConfig = {
  MCP_SERVER_REQUEST_TIMEOUT: {
    description: "Timeout for requests to the MCP server (ms)",
    value: 10000,
  },
} as const;