/**
 * Types for the remote transport protocol.
 */
import type { MCPServerConfig, FetchRequestEntryBase } from "../types.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
export interface RemoteConnectRequest {
    /** MCP server config (stdio, sse, or streamable-http) */
    config: MCPServerConfig;
    /** Optional OAuth tokens for Bearer authentication (for HTTP transports) */
    oauthTokens?: {
        access_token: string;
        token_type: string;
        expires_in?: number;
        refresh_token?: string;
    };
}
export interface RemoteConnectResponse {
    sessionId: string;
}
export interface RemoteSendRequest {
    message: JSONRPCMessage;
    /** Optional, for associating response with request (e.g. streamable-http) */
    relatedRequestId?: string | number;
}
export type RemoteEventType = "message" | "fetch_request" | "stdio_log" | "transport_error";
export interface RemoteEventMessage {
    type: "message";
    data: unknown;
}
export interface RemoteEventFetchRequest {
    type: "fetch_request";
    data: FetchRequestEntryBase;
}
export interface RemoteEventStdioLog {
    type: "stdio_log";
    data: {
        timestamp: string;
        message: string;
    };
}
export interface RemoteEventTransportError {
    type: "transport_error";
    data: {
        error: string;
        code?: string | number;
    };
}
export type RemoteEvent = RemoteEventMessage | RemoteEventFetchRequest | RemoteEventStdioLog | RemoteEventTransportError;
//# sourceMappingURL=types.d.ts.map