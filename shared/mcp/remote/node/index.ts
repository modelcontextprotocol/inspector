/**
 * Remote server (Node) - Hono app for /api/mcp/*, /api/fetch, /api/log.
 */

export {
  createRemoteApp,
  type RemoteServerOptions,
  type CreateRemoteAppResult,
} from "./server.js";
// Re-export constants from base remote directory (browser-safe)
export { API_SERVER_ENV_VARS } from "../constants.js";
