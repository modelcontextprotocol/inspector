import type {
  MCPServerConfig,
  StdioServerConfig,
  SseServerConfig,
  StreamableHttpServerConfig,
} from "../types.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { StderrLogEntry } from "../types.js";

export type ServerType = "stdio" | "sse" | "streamableHttp";

export function getServerType(config: MCPServerConfig): ServerType {
  if ("type" in config) {
    if (config.type === "sse") return "sse";
    if (config.type === "streamableHttp") return "streamableHttp";
  }
  return "stdio";
}

export interface CreateTransportOptions {
  /**
   * Optional callback to handle stderr logs from stdio transports
   */
  onStderr?: (entry: StderrLogEntry) => void;

  /**
   * Whether to pipe stderr for stdio transports (default: true for TUI, false for CLI)
   */
  pipeStderr?: boolean;
}

export interface CreateTransportResult {
  transport: Transport;
}

/**
 * Creates the appropriate transport for an MCP server configuration
 */
export function createTransport(
  config: MCPServerConfig,
  options: CreateTransportOptions = {},
): CreateTransportResult {
  const serverType = getServerType(config);
  const { onStderr, pipeStderr = false } = options;

  if (serverType === "stdio") {
    const stdioConfig = config as StdioServerConfig;
    const transport = new StdioClientTransport({
      command: stdioConfig.command,
      args: stdioConfig.args || [],
      env: stdioConfig.env,
      cwd: stdioConfig.cwd,
      stderr: pipeStderr ? "pipe" : undefined,
    });

    // Set up stderr listener if requested
    if (pipeStderr && transport.stderr && onStderr) {
      transport.stderr.on("data", (data: Buffer) => {
        const logEntry = data.toString().trim();
        if (logEntry) {
          onStderr({
            timestamp: new Date(),
            message: logEntry,
          });
        }
      });
    }

    return { transport: transport };
  } else if (serverType === "sse") {
    const sseConfig = config as SseServerConfig;
    const url = new URL(sseConfig.url);

    // Merge headers and requestInit
    const eventSourceInit: Record<string, unknown> = {
      ...sseConfig.eventSourceInit,
      ...(sseConfig.headers && { headers: sseConfig.headers }),
    };

    const requestInit: RequestInit = {
      ...sseConfig.requestInit,
      ...(sseConfig.headers && { headers: sseConfig.headers }),
    };

    const transport = new SSEClientTransport(url, {
      eventSourceInit,
      requestInit,
    });

    return { transport };
  } else {
    // streamableHttp
    const httpConfig = config as StreamableHttpServerConfig;
    const url = new URL(httpConfig.url);

    // Merge headers and requestInit
    const requestInit: RequestInit = {
      ...httpConfig.requestInit,
      ...(httpConfig.headers && { headers: httpConfig.headers }),
    };

    const transport = new StreamableHTTPClientTransport(url, {
      requestInit,
    });

    return { transport };
  }
}
