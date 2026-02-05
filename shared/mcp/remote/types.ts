/**
 * Types for the remote transport protocol.
 */

import type { MCPServerConfig, FetchRequestEntryBase } from "../types.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export interface RemoteConnectRequest {
  /** MCP server config (stdio, sse, or streamable-http) */
  config: MCPServerConfig;
}

export interface RemoteConnectResponse {
  sessionId: string;
}

export interface RemoteSendRequest {
  message: JSONRPCMessage;
  /** Optional, for associating response with request (e.g. streamable-http) */
  relatedRequestId?: string | number;
}

export type RemoteEventType = "message" | "fetch_request" | "stdio_log";

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
  data: { timestamp: string; message: string };
}

export type RemoteEvent =
  | RemoteEventMessage
  | RemoteEventFetchRequest
  | RemoteEventStdioLog;
