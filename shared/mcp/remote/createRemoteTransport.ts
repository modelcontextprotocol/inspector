/**
 * Factory for createRemoteTransport - returns a CreateTransport that uses the remote server.
 */

import type {
  MCPServerConfig,
  CreateTransport,
  CreateTransportOptions,
  CreateTransportResult,
} from "../types.js";
import { RemoteClientTransport } from "./remoteClientTransport.js";

export interface RemoteTransportFactoryOptions {
  /** Base URL of the remote server (e.g. http://localhost:3000) */
  baseUrl: string;

  /** Optional auth token for x-mcp-remote-auth header */
  authToken?: string;

  /** Optional fetch implementation (for proxy or testing) */
  fetchFn?: typeof fetch;
}

/**
 * Creates a CreateTransport that produces RemoteClientTransport instances
 * connecting to the given remote server.
 *
 * @example
 * const createTransport = createRemoteTransport({
 *   baseUrl: 'http://localhost:3000',
 *   authToken: process.env.MCP_REMOTE_TOKEN,
 * });
 * const inspector = new InspectorClient(config, {
 *   transportClientFactory: createTransport,
 *   ...
 * });
 */
export function createRemoteTransport(
  options: RemoteTransportFactoryOptions,
): CreateTransport {
  return (
    config: MCPServerConfig,
    transportOptions: CreateTransportOptions = {},
  ): CreateTransportResult => {
    // Use only the factory's fetchFn, not InspectorClient's. The transport's HTTP
    // (connect, GET events, send, disconnect) must support streaming (GET /api/mcp/events
    // is SSE). A remoted fetch (e.g. createRemoteFetch) buffers responses and cannot
    // stream. So we ignore transportOptions.fetchFn here; auth can still use a
    // remoted fetch via InspectorClient's fetchFn (effectiveAuthFetch).
    const transport = new RemoteClientTransport(
      {
        baseUrl: options.baseUrl,
        authToken: options.authToken,
        fetchFn: options.fetchFn,
        onStderr: transportOptions.onStderr,
        onFetchRequest: transportOptions.onFetchRequest,
      },
      config,
    );
    return { transport };
  };
}
