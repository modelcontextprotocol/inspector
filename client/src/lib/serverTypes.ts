import { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse.js";

export type BaseServerOptions = {
  transportType: "stdio" | "sse" | "streamable-http";
  timeout?: number;
  capabilities?: ClientCapabilities;
  enableServerLogs?: boolean;
};

export type StdioServerDefinition = BaseServerOptions & {
  command: string; // 'command' is required for Stdio
  args?: string[];
  env?: Record<string, string>;

  url?: never; // Exclude 'url' for Stdio
  requestInit?: never; // Exclude HTTP options for Stdio
  eventSourceInit?: never; // Exclude HTTP options for Stdio
  reconnectionOptions?: never; // Exclude Streamable HTTP specific options
  sessionId?: never; // Exclude Streamable HTTP specific options
};

// HTTP Server Definition (Streamable HTTP or SSE fallback)
export type HttpServerDefinition = BaseServerOptions & {
  url: URL; // 'url' is required for HTTP or SSE

  // Include relevant options from SDK HTTP transport types
  requestInit?: StreamableHTTPClientTransportOptions["requestInit"];
  eventSourceInit?: SSEClientTransportOptions["eventSourceInit"];
  reconnectionOptions?: StreamableHTTPClientTransportOptions["reconnectionOptions"];
  sessionId?: StreamableHTTPClientTransportOptions["sessionId"];
};

export type MCPJamServerConfig = StdioServerDefinition | HttpServerDefinition;
