/**
 * Factory for createRemoteTransport - returns a CreateTransport that uses the remote server.
 */
import { RemoteClientTransport } from "./remoteClientTransport.js";
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
export function createRemoteTransport(options) {
    return (config, transportOptions = {}) => {
        // Use only the factory's fetchFn, not InspectorClient's. The transport's HTTP
        // (connect, GET events, send, disconnect) must support streaming (GET /api/mcp/events
        // is SSE). A remoted fetch (e.g. createRemoteFetch) buffers responses and cannot
        // stream. So we ignore transportOptions.fetchFn here; auth can still use a
        // remoted fetch via InspectorClient's fetchFn (effectiveAuthFetch).
        const transport = new RemoteClientTransport({
            baseUrl: options.baseUrl,
            authToken: options.authToken,
            fetchFn: options.fetchFn,
            onStderr: transportOptions.onStderr,
            onFetchRequest: transportOptions.onFetchRequest,
            authProvider: transportOptions.authProvider,
        }, config);
        return { transport };
    };
}
//# sourceMappingURL=createRemoteTransport.js.map