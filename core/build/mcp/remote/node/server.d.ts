/**
 * Hono-based remote server for MCP transports.
 * Hosts /api/config, /api/mcp/connect, send, events, disconnect, /api/fetch, /api/log, /api/storage/:storeId.
 */
import type pino from "pino";
import { Hono } from "hono";
export interface RemoteServerOptions {
    /** Optional auth token. If not provided, uses API_SERVER_ENV_VARS.AUTH_TOKEN env var or generates one. */
    authToken?: string;
    /** Optional: validate Origin header against allowed origins (for CORS) */
    allowedOrigins?: string[];
    /** Optional pino file logger. When set, /api/log forwards received events to it. */
    logger?: pino.Logger;
    /** Optional storage directory for /api/storage/:storeId. Default: ~/.mcp-inspector/storage */
    storageDir?: string;
}
export interface CreateRemoteAppResult {
    /** The Hono app */
    app: Hono;
    /** The auth token (from options, env var, or generated). Returned so caller can embed in client. */
    authToken: string;
}
export declare function createRemoteApp(options?: RemoteServerOptions): CreateRemoteAppResult;
//# sourceMappingURL=server.d.ts.map