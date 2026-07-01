import { getServerType } from "../config.js";
import type {
  MCPServerConfig,
  StdioServerConfig,
  SseServerConfig,
  StreamableHttpServerConfig,
  CreateTransportOptions,
  CreateTransportResult,
  InspectorServerSettings,
} from "../types.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createFetchTracker } from "../fetchTracking.js";
import type { Dispatcher } from "undici";

/** Node's `RequestInit` plus the undici-specific `dispatcher` option. */
type NodeRequestInit = RequestInit & { dispatcher?: Dispatcher };

/** Standard proxy env vars, in the precedence undici's EnvHttpProxyAgent uses. */
const PROXY_ENV_VARS = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
] as const;

/**
 * First proxy URL found in the environment, or `undefined` if none is set.
 * Exported for tests and so callers can decide whether proxying is in effect.
 */
export function readProxyEnv(): string | undefined {
  for (const name of PROXY_ENV_VARS) {
    const value = process.env[name];
    if (value && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * Wraps a fetch function so outbound HTTP/HTTPS requests honor the standard
 * `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` environment variables.
 *
 * Node's built-in `fetch` (the bundled undici) accepts a `dispatcher` option
 * in `RequestInit`; undici's `EnvHttpProxyAgent` reads the proxy env vars and
 * routes per-request, so a single dispatcher covers both schemes and respects
 * `NO_PROXY`. The `undici` package is loaded lazily on first call so callers
 * that never set a proxy env var (TUI, web backend) need no extra dependency.
 * If the proxy is configured but `undici` is unavailable, the wrapper throws
 * with an actionable message rather than silently ignoring the env var.
 */
export function withProxyDispatcher(baseFetch: typeof fetch): typeof fetch {
  if (readProxyEnv() === undefined) return baseFetch;

  let dispatcherPromise: Promise<Dispatcher> | undefined;
  const getDispatcher = (): Promise<Dispatcher> => {
    dispatcherPromise ??= import("undici").then(
      ({ EnvHttpProxyAgent }) => new EnvHttpProxyAgent(),
      (cause: unknown) => {
        throw new Error(
          "HTTPS_PROXY / HTTP_PROXY is set but the `undici` package is not " +
            "available. Install it (it ships with the CLI client) or unset the " +
            "proxy env var.",
          { cause },
        );
      },
    );
    return dispatcherPromise;
  };

  const proxiedFetch: typeof fetch = async (input, init) => {
    const dispatcher = await getDispatcher();
    return baseFetch(input, { ...init, dispatcher } as NodeRequestInit);
  };
  return proxiedFetch;
}

/**
 * Build the wire `headers` record from `settings.headers`, dropping rows with
 * empty keys (the form lets users leave new rows blank). Returns `undefined`
 * when the result is empty so we can omit the field instead of sending `{}`.
 */
function headersFromSettings(
  settings: InspectorServerSettings | undefined,
): Record<string, string> | undefined {
  if (!settings || settings.headers.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const { key, value } of settings.headers) {
    if (key.trim() === "") continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Creates the appropriate transport for an MCP server configuration.
 */
export function createTransportNode(
  config: MCPServerConfig,
  options: CreateTransportOptions = {},
): CreateTransportResult {
  const serverType = getServerType(config);
  const {
    fetchFn: optionsFetchFn,
    onStderr,
    pipeStderr = false,
    onFetchRequest,
    onFetchResponseBody,
    authProvider,
    settings,
  } = options;

  const baseFetch = withProxyDispatcher(optionsFetchFn ?? globalThis.fetch);

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

    const sseFetch =
      (sseConfig.eventSourceInit?.fetch as typeof fetch) || baseFetch;
    const trackedFetch = onFetchRequest
      ? createFetchTracker(sseFetch, {
          trackRequest: onFetchRequest,
          updateResponseBody: onFetchResponseBody,
        })
      : sseFetch;

    const headers = headersFromSettings(settings);

    const eventSourceInit: Record<string, unknown> = {
      ...sseConfig.eventSourceInit,
      ...(headers && { headers }),
      fetch: trackedFetch,
    };

    const requestInit: RequestInit = {
      ...sseConfig.requestInit,
      ...(headers && { headers }),
    };

    const postFetch = onFetchRequest
      ? createFetchTracker(baseFetch, {
          trackRequest: onFetchRequest,
          updateResponseBody: onFetchResponseBody,
        })
      : baseFetch;

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

    const headers = headersFromSettings(settings);

    const requestInit: RequestInit = {
      ...httpConfig.requestInit,
      ...(headers && { headers }),
    };

    const transportFetch = onFetchRequest
      ? createFetchTracker(baseFetch, {
          trackRequest: onFetchRequest,
          updateResponseBody: onFetchResponseBody,
        })
      : baseFetch;

    const transport = new StreamableHTTPClientTransport(url, {
      authProvider,
      requestInit,
      fetch: transportFetch,
    });

    return { transport };
  }
}
