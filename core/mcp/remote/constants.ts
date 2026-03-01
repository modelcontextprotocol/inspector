/**
 * Environment variable names for the remote server.
 * This is shared between browser and Node.js code, so it's in the base remote directory.
 */
/** Legacy env var name; prefer AUTH_TOKEN. Honored when AUTH_TOKEN is not set. */
export const LEGACY_AUTH_TOKEN_ENV = "MCP_PROXY_AUTH_TOKEN";

export const API_SERVER_ENV_VARS = {
  /**
   * Auth token for authenticating requests to the remote API server.
   * Used by the x-mcp-remote-auth header (or Authorization header if changed).
   */
  AUTH_TOKEN: "MCP_INSPECTOR_API_TOKEN",
} as const;
