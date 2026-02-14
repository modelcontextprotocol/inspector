/**
 * RemoteClientTransport - Transport that talks to a remote server via HTTP.
 * Pure TypeScript; works in browser, Deno, or Node.
 */
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";
import type { StderrLogEntry } from "../types.js";
import type { FetchRequestEntryBase } from "../types.js";
export interface RemoteTransportOptions {
    /** Base URL of the remote server (e.g. http://localhost:3000) */
    baseUrl: string;
    /** Optional auth token for x-mcp-remote-auth header */
    authToken?: string;
    /** Optional fetch implementation (for proxy or testing) */
    fetchFn?: typeof fetch;
    /** Callback for stderr from stdio transports (forwarded via remote) */
    onStderr?: (entry: StderrLogEntry) => void;
    /** Callback for fetch request tracking (forwarded via remote) */
    onFetchRequest?: (entry: FetchRequestEntryBase) => void;
    /** Optional OAuth client provider for Bearer authentication */
    authProvider?: import("@modelcontextprotocol/sdk/client/auth.js").OAuthClientProvider;
}
/**
 * Transport that forwards JSON-RPC to a remote server and receives responses via SSE.
 */
export declare class RemoteClientTransport implements Transport {
    private readonly options;
    private readonly config;
    private _sessionId;
    private eventStreamReader;
    private eventStreamAbort;
    private closed;
    /**
     * Intentionally returns undefined. The MCP Client checks transport.sessionId to detect
     * reconnects and skip initialize. Our _sessionId is the remote server's session ID, not
     * the MCP protocol's initialization state. Exposing it would cause the MCP Client to
     * skip initialize and send tools/list first, which fails on streamable-http (and any
     * transport requiring initialize before other requests).
     */
    get sessionId(): string | undefined;
    constructor(options: RemoteTransportOptions, config: import("../types.js").MCPServerConfig);
    private get fetchFn();
    private get baseUrl();
    private get headers();
    start(): Promise<void>;
    private consumeEventStream;
    send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void>;
    close(): Promise<void>;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
}
//# sourceMappingURL=remoteClientTransport.d.ts.map