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

/**
 * Name of the global property the web backend injects into `index.html` so the
 * browser can recover the API token without depending on the
 * `?MCP_INSPECTOR_API_TOKEN=…` query string surviving navigation (or a manual
 * reload at the bare URL). The dev Vite plugin and the prod Hono server both
 * embed `<script>window.__INSPECTOR_API_TOKEN__ = "…"</script>` on the served
 * page; `App.tsx`'s `getAuthToken()` reads it ahead of the URL / sessionStorage
 * fallbacks. See `clients/web/server/inject-auth-token.ts`.
 */
export const INSPECTOR_API_TOKEN_GLOBAL = "__INSPECTOR_API_TOKEN__";
