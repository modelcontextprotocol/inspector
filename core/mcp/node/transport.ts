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
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { SSEClientTransport } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createFetchTracker } from "../fetchTracking.js";
import {
  createAuthChallengeInterceptFetch,
  createAuthChallengeObserverFetch,
} from "./authChallengeFetch.js";
import { createProxyFetch } from "./proxyFetch.js";

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
    interceptAuthChallenges = false,
    onAuthChallengeObserved,
  } = options;

  // `optionsFetchFn` is the caller's whole fetch stack and already sits on top of
  // a proxy-aware base when one is needed — the Node clients install
  // `createProxyFetch()` as `environment.fetch`, and `InspectorClient` wraps
  // that. The fallback is for the one caller that supplies nothing: the web
  // backend (`core/mcp/remote/node/server.ts`), which calls this directly.
  const baseFetch = optionsFetchFn ?? createProxyFetch() ?? globalThis.fetch;
  // Purely passive, so — unlike proxying and interception — it is safe to
  // apply to any fetch, including a caller's explicit one.
  const withChallengeObserver = (inner: typeof fetch): typeof fetch =>
    onAuthChallengeObserved
      ? createAuthChallengeObserverFetch(inner, onAuthChallengeObserved)
      : inner;
  // The observer sits *under* the interceptor so it still reports the
  // challenge on the path where interception throws — and, more to the point,
  // on the legacy first-auth path where interception is off entirely.
  const fetchWithOptionalAuthIntercept = interceptAuthChallenges
    ? createAuthChallengeInterceptFetch(withChallengeObserver(baseFetch))
    : withChallengeObserver(baseFetch);

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

    // A caller-supplied eventSourceInit.fetch wins as-is (explicit fetch is not
    // re-wrapped for proxying); the default path uses fetchWithOptionalAuthIntercept
    // (the proxy-aware baseFetch plus the optional auth-challenge intercept).
    // The challenge observer is applied either way: it is passive, and without
    // it a first-time legacy SSE authorization through an explicit fetch would
    // lose the challenge's `resource_metadata` the same way (Copilot).
    const configuredSseFetch = sseConfig.eventSourceInit?.fetch as
      | typeof fetch
      | undefined;
    const sseFetch = configuredSseFetch
      ? withChallengeObserver(configuredSseFetch)
      : fetchWithOptionalAuthIntercept;
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
      ? createFetchTracker(fetchWithOptionalAuthIntercept, {
          trackRequest: onFetchRequest,
          updateResponseBody: onFetchResponseBody,
        })
      : fetchWithOptionalAuthIntercept;

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
      ? createFetchTracker(fetchWithOptionalAuthIntercept, {
          trackRequest: onFetchRequest,
          updateResponseBody: onFetchResponseBody,
        })
      : fetchWithOptionalAuthIntercept;

    const transport = new StreamableHTTPClientTransport(url, {
      authProvider,
      requestInit,
      fetch: transportFetch,
      // SEP-2350: how the transport reacts to a `403 insufficient_scope`
      // challenge. Defaults to the SDK's `reauthorize` when unset.
      ...(settings?.oauthOnInsufficientScope && {
        onInsufficientScope: settings.oauthOnInsufficientScope,
      }),
    });

    return { transport };
  }
}
