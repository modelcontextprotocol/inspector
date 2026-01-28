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
   * Optional function to get OAuth access token for Bearer authentication
   * This will be called for each HTTP request to inject the Authorization header
   */
  getOAuthToken?: () => Promise<string | undefined>;
}

export interface CreateTransportResult {
  transport: Transport;
}

/**
 * Creates the appropriate transport for an MCP server configuration
 */
/**
 * Creates a fetch wrapper that injects OAuth Bearer tokens into requests
 */
function createOAuthFetchWrapper(
  baseFetch: typeof fetch,
  getOAuthToken?: () => Promise<string | undefined>,
): typeof fetch {
  if (!getOAuthToken) {
    return baseFetch;
  }

  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const token = await getOAuthToken();
    const headers = new Headers(init?.headers);

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    return baseFetch(input, {
      ...init,
      headers,
    });
  };
}

export function createTransport(
  config: MCPServerConfig,
  options: CreateTransportOptions = {},
): CreateTransportResult {
  const serverType = getServerType(config);
  const {
    onStderr,
    pipeStderr = false,
    onFetchRequest,
    getOAuthToken,
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

    // Get base fetch function
    const baseFetch =
      (sseConfig.eventSourceInit?.fetch as typeof fetch) || globalThis.fetch;

    // Create OAuth-aware fetch wrapper
    const oauthFetch = createOAuthFetchWrapper(baseFetch, getOAuthToken);

    // Merge headers and requestInit
    const eventSourceInit: Record<string, unknown> = {
      ...sseConfig.eventSourceInit,
      ...(sseConfig.headers && { headers: sseConfig.headers }),
      fetch: onFetchRequest
        ? createFetchTracker(oauthFetch, {
            trackRequest: onFetchRequest,
          })
        : oauthFetch,
    };

    // For SSE, POST requests also need OAuth token via fetch
    // Create OAuth-aware fetch for POST requests
    const oauthFetchForPost = createOAuthFetchWrapper(
      globalThis.fetch,
      getOAuthToken,
    );

    const requestInit: RequestInit = {
      ...sseConfig.requestInit,
      ...(sseConfig.headers && { headers: sseConfig.headers }),
    };

    const transport = new SSEClientTransport(url, {
      eventSourceInit,
      requestInit,
      // Pass OAuth-aware fetch for POST requests
      fetch: onFetchRequest
        ? createFetchTracker(oauthFetchForPost, {
            trackRequest: onFetchRequest,
          })
        : oauthFetchForPost,
    });

    return { transport };
  } else {
    // streamable-http
    const httpConfig = config as StreamableHttpServerConfig;
    const url = new URL(httpConfig.url);

    // Get base fetch function
    const baseFetch = globalThis.fetch;

    // Create OAuth-aware fetch wrapper
    const oauthFetch = createOAuthFetchWrapper(baseFetch, getOAuthToken);

    // Merge headers and requestInit
    const requestInit: RequestInit = {
      ...httpConfig.requestInit,
      ...(httpConfig.headers && { headers: httpConfig.headers }),
    };

    // Add fetch tracking and OAuth support
    const transportOptions: {
      requestInit?: RequestInit;
      fetch?: typeof fetch;
    } = {
      requestInit,
      fetch: onFetchRequest
        ? createFetchTracker(oauthFetch, {
            trackRequest: onFetchRequest,
          })
        : oauthFetch,
    };

    const transport = new StreamableHTTPClientTransport(url, transportOptions);

    return { transport };
  }
}
