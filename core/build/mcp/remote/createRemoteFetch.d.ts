/**
 * Creates a fetch implementation that POSTs requests to the remote /api/fetch endpoint.
 * Use in the browser to bypass CORS for OAuth and MCP HTTP requests.
 */
export interface RemoteFetchOptions {
    /** Base URL of the remote server (e.g. http://localhost:3000) */
    baseUrl: string;
    /** Optional auth token for x-mcp-remote-auth header */
    authToken?: string;
    /** Base fetch to use for the POST to the remote (default: globalThis.fetch) */
    fetchFn?: typeof fetch;
}
/**
 * Returns a fetch function that forwards requests to the remote /api/fetch endpoint.
 * The remote server performs the actual HTTP request in Node (no CORS).
 */
export declare function createRemoteFetch(options: RemoteFetchOptions): typeof fetch;
//# sourceMappingURL=createRemoteFetch.d.ts.map