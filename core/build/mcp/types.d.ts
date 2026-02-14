export interface StdioServerConfig {
    type?: "stdio";
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
}
export interface SseServerConfig {
    type: "sse";
    url: string;
    headers?: Record<string, string>;
    eventSourceInit?: Record<string, unknown>;
    requestInit?: Record<string, unknown>;
}
export interface StreamableHttpServerConfig {
    type: "streamable-http";
    url: string;
    headers?: Record<string, string>;
    requestInit?: Record<string, unknown>;
}
export type MCPServerConfig = StdioServerConfig | SseServerConfig | StreamableHttpServerConfig;
export type ServerType = "stdio" | "sse" | "streamable-http";
export interface MCPConfig {
    mcpServers: Record<string, MCPServerConfig>;
}
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
export interface StderrLogEntry {
    timestamp: Date;
    message: string;
}
import type { ServerCapabilities, Implementation, JSONRPCRequest, JSONRPCNotification, JSONRPCResultResponse, JSONRPCErrorResponse } from "@modelcontextprotocol/sdk/types.js";
export interface MessageEntry {
    id: string;
    timestamp: Date;
    direction: "request" | "response" | "notification";
    message: JSONRPCRequest | JSONRPCNotification | JSONRPCResultResponse | JSONRPCErrorResponse;
    response?: JSONRPCResultResponse | JSONRPCErrorResponse;
    duration?: number;
}
export type FetchRequestCategory = "auth" | "transport";
export interface FetchRequestEntry {
    id: string;
    timestamp: Date;
    method: string;
    url: string;
    requestHeaders: Record<string, string>;
    requestBody?: string;
    responseStatus?: number;
    responseStatusText?: string;
    responseHeaders?: Record<string, string>;
    responseBody?: string;
    duration?: number;
    error?: string;
    /** Distinguishes OAuth/auth fetches from MCP transport fetches */
    category: FetchRequestCategory;
}
/** Entry shape from createFetchTracker before category is added by the caller */
export type FetchRequestEntryBase = Omit<FetchRequestEntry, "category">;
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
export interface CreateTransportOptions {
    /**
     * Optional fetch function. When provided, used as the base for transport HTTP requests
     * (SSE, streamable-http). Enables proxy fetch in browser (CORS bypass).
     */
    fetchFn?: typeof fetch;
    /**
     * Optional callback to handle stderr logs from stdio transports
     */
    onStderr?: (entry: StderrLogEntry) => void;
    /**
     * Whether to pipe stderr for stdio transports (default: true for TUI, false for CLI)
     */
    pipeStderr?: boolean;
    /**
     * Optional callback to track HTTP fetch requests (for SSE and streamable-http transports).
     * Receives entries without category; caller adds category when storing.
     */
    onFetchRequest?: (entry: FetchRequestEntryBase) => void;
    /**
     * Optional OAuth client provider for Bearer authentication (SSE, streamable-http).
     * When set, the SDK injects tokens and handles 401 via the provider.
     */
    authProvider?: OAuthClientProvider;
}
export interface CreateTransportResult {
    transport: Transport;
}
/**
 * Factory that creates a client transport for an MCP server configuration.
 * Required by InspectorClient; caller provides the implementation for their
 * environment (e.g. createTransport for Node, RemoteClientTransport factory for browser).
 */
export type CreateTransport = (config: MCPServerConfig, options: CreateTransportOptions) => CreateTransportResult;
export interface ServerState {
    status: ConnectionStatus;
    error: string | null;
    capabilities?: ServerCapabilities;
    serverInfo?: Implementation;
    instructions?: string;
    resources: any[];
    prompts: any[];
    tools: any[];
    stderrLogs: StderrLogEntry[];
}
import type { ReadResourceResult, GetPromptResult, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { JsonValue } from "../json/jsonUtils.js";
/**
 * Represents a complete resource read invocation, including request parameters,
 * response, and metadata. This object is returned from InspectorClient.readResource()
 * and cached for later retrieval.
 */
export interface ResourceReadInvocation {
    result: ReadResourceResult;
    timestamp: Date;
    uri: string;
    metadata?: Record<string, string>;
}
/**
 * Represents a complete resource template read invocation, including request parameters,
 * response, and metadata. This object is returned from InspectorClient.readResourceFromTemplate()
 * and cached for later retrieval.
 */
export interface ResourceTemplateReadInvocation {
    uriTemplate: string;
    expandedUri: string;
    result: ReadResourceResult;
    timestamp: Date;
    params: Record<string, string>;
    metadata?: Record<string, string>;
}
/**
 * Represents a complete prompt get invocation, including request parameters,
 * response, and metadata. This object is returned from InspectorClient.getPrompt()
 * and cached for later retrieval.
 */
export interface PromptGetInvocation {
    result: GetPromptResult;
    timestamp: Date;
    name: string;
    params?: Record<string, string>;
    metadata?: Record<string, string>;
}
/**
 * Represents a complete tool call invocation, including request parameters,
 * response, and metadata. This object is returned from InspectorClient.callTool()
 * and cached for later retrieval.
 */
export interface ToolCallInvocation {
    toolName: string;
    params: Record<string, JsonValue>;
    result: CallToolResult | null;
    timestamp: Date;
    success: boolean;
    error?: string;
    metadata?: Record<string, string>;
}
//# sourceMappingURL=types.d.ts.map