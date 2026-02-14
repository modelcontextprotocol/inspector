/**
 * Factory for createRemoteTransport - returns a CreateTransport that uses the remote server.
 */
import type { CreateTransport } from "../types.js";
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
 * import { API_SERVER_ENV_VARS } from '@modelcontextprotocol/inspector-core/mcp/remote';
 * const createTransport = createRemoteTransport({
 *   baseUrl: 'http://localhost:3000',
 *   authToken: process.env[API_SERVER_ENV_VARS.AUTH_TOKEN],
 * });
 * const inspector = new InspectorClient(config, {
 *   environment: {
 *     transport: createTransport,
 *   },
 *   ...
 * });
 */
export declare function createRemoteTransport(options: RemoteTransportFactoryOptions): CreateTransport;
//# sourceMappingURL=createRemoteTransport.d.ts.map