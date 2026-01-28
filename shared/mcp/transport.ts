import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  MCPServerConfig,
  StdioServerConfig,
  SseServerConfig,
  StreamableHttpServerConfig,
  StderrLogEntry,
  FetchRequestEntry,
} from "./types.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createFetchTracker } from "./fetchTracking.js";

export type ServerType = "stdio" | "sse" | "streamable-http";

export function getServerType(config: MCPServerConfig): ServerType {
  // If type is not present, default to stdio
  if (!("type" in config) || config.type === undefined) {
    return "stdio";
  }

  // If type is present, validate it matches one of the valid values
  const type = config.type;
  if (type === "stdio") {
    return "stdio";
  }
  if (type === "sse") {
    return "sse";
  }
  if (type === "streamable-http") {
    return "streamable-http";
  }

  // If type is present but doesn't match any valid value, throw error
  throw new Error(
    `Invalid server type: ${type}. Valid types are: stdio, sse, streamable-http`,
  );
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

  /**
   * Optional callback to track HTTP fetch requests (for SSE and streamable-http transports)
   */
  onFetchRequest?: (entry: import("./types.js").FetchRequestEntry) => void;

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
 * Creates the appropriate transport for an MCP server configuration
 */
export function createTransport(
  config: MCPServerConfig,
  options: CreateTransportOptions = {},
): CreateTransportResult {
  const serverType = getServerType(config);
  const {
    onStderr,
    pipeStderr = false,
    onFetchRequest,
    authProvider,
  } = options;

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

    const baseFetch =
      (sseConfig.eventSourceInit?.fetch as typeof fetch) || globalThis.fetch;
    const trackedFetch = onFetchRequest
      ? createFetchTracker(baseFetch, { trackRequest: onFetchRequest })
      : baseFetch;

    const eventSourceInit: Record<string, unknown> = {
      ...sseConfig.eventSourceInit,
      ...(sseConfig.headers && { headers: sseConfig.headers }),
      fetch: trackedFetch,
    };

    const requestInit: RequestInit = {
      ...sseConfig.requestInit,
      ...(sseConfig.headers && { headers: sseConfig.headers }),
    };

    const postFetch = onFetchRequest
      ? createFetchTracker(globalThis.fetch, { trackRequest: onFetchRequest })
      : globalThis.fetch;

    const transport = new SSEClientTransport(url, {
      authProvider,
      eventSourceInit,
      requestInit,
      fetch: postFetch,
    });

    return { transport };
  } else {
    // streamable-http
    const httpConfig = config as StreamableHttpServerConfig;
    const url = new URL(httpConfig.url);

    const requestInit: RequestInit = {
      ...httpConfig.requestInit,
      ...(httpConfig.headers && { headers: httpConfig.headers }),
    };

    const baseFetch = globalThis.fetch;
    const fetchFn = onFetchRequest
      ? createFetchTracker(baseFetch, { trackRequest: onFetchRequest })
      : baseFetch;

    const transport = new StreamableHTTPClientTransport(url, {
      authProvider,
      requestInit,
      fetch: fetchFn,
    });

    return { transport };
  }
}
