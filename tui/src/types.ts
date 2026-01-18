// Stdio transport config
export interface StdioServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

// SSE transport config
export interface SseServerConfig {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
  eventSourceInit?: Record<string, unknown>;
  requestInit?: Record<string, unknown>;
}

// StreamableHTTP transport config
export interface StreamableHttpServerConfig {
  type: "streamableHttp";
  url: string;
  headers?: Record<string, string>;
  requestInit?: Record<string, unknown>;
}

export type MCPServerConfig =
  | StdioServerConfig
  | SseServerConfig
  | StreamableHttpServerConfig;

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface StderrLogEntry {
  timestamp: Date;
  message: string;
}

export interface ServerState {
  status: ConnectionStatus;
  error: string | null;
  capabilities: {
    resources?: boolean;
    prompts?: boolean;
    tools?: boolean;
  };
  serverInfo?: {
    name?: string;
    version?: string;
  };
  instructions?: string;
  resources: any[];
  prompts: any[];
  tools: any[];
  stderrLogs: StderrLogEntry[];
}
