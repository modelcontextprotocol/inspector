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
import { createGuardedFetch } from "./fetchGuard.js";
import { exemptMcpEndpoint } from "../../auth/requestTimeout.js";
import { routeOAuthRequests } from "../../auth/routeOAuthRequests.js";
import { createNotificationHeadersFetch } from "./notificationHeadersFetch.js";
import { createSuppressNotificationStreamFetch } from "./suppressNotificationStreamFetch.js";

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
 * The base fetch for a transport whose caller supplies none — the web backend.
 *
 * MCP-endpoint requests go out on the proxy-aware plain fetch. Everything else
 * on the chain is the OAuth work the SDK runs from inside the transport on a
 * 401 or a refresh, with the tokens the browser handed the backend and on URLs
 * the server under test chose, so it goes through the destination guard
 * (#2749), as the browser's own OAuth does via `/api/fetch`.
 */
export function createBackendBaseFetch(config: MCPServerConfig): typeof fetch {
  return routeOAuthRequests(
    createProxyFetch() ?? globalThis.fetch,
    createGuardedFetch(),
    exemptMcpEndpoint(
      () => ("url" in config ? config.url : undefined),
      () => getServerType(config) === "sse",
    ),
  );
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
    onFetchStreamUpdate,
    authProvider,
    settings,
    interceptAuthChallenges = false,
    onAuthChallengeObserved,
  } = options;
  // Any of the three tracking callbacks earns a tracker: each is optional on
  // the tracker itself, and a caller that wants only stream updates (or only
  // bodies) must not be silently handed the bare fetch (#2318).
  const wantsFetchTracking = Boolean(
    onFetchRequest || onFetchResponseBody || onFetchStreamUpdate,
  );

  // `optionsFetchFn` is the caller's whole fetch stack and already sits on top of
  // a proxy-aware base when one is needed — the Node clients install
  // `createProxyFetch()` as `environment.fetch`, and `InspectorClient` wraps
  // that. The fallback is for the one caller that supplies nothing: the web
  // backend (`core/mcp/remote/node/server.ts`), which calls this directly,
  // and it routes OAuth through the destination guard (#2749).
  const baseFetch = optionsFetchFn ?? createBackendBaseFetch(config);
  // Purely passive, so — unlike proxying and interception — it is safe to
  // apply to any fetch, including a caller's explicit one.
  const withChallengeObserver = (inner: typeof fetch): typeof fetch =>
    onAuthChallengeObserved
      ? createAuthChallengeObserverFetch(inner, onAuthChallengeObserved)
      : inner;
  const withTracking = (inner: typeof fetch): typeof fetch =>
    wantsFetchTracking
      ? createFetchTracker(inner, {
          trackRequest: onFetchRequest,
          updateResponseBody: onFetchResponseBody,
          updateStream: onFetchStreamUpdate,
        })
      : inner;
  // The observer sits *under* the interceptor so it still reports the
  // challenge on the path where interception throws — and, more to the point,
  // on the legacy first-auth path where interception is off entirely.
  //
  // The network tracker sits under the interceptor too (#2297). Above it, the
  // tracker never saw the 401/403 at all: the interceptor cancels the body and
  // throws, so the entry was recorded from the thrown error alone — no status,
  // no `WWW-Authenticate`, and no response body, which is exactly the detail
  // someone debugging an OAuth challenge needs. Below it, the tracker records
  // the real response and reads its body (bounded) before the interceptor
  // cancels it.
  const trackedBase = withTracking(withChallengeObserver(baseFetch));
  const fetchWithOptionalAuthIntercept = interceptAuthChallenges
    ? createAuthChallengeInterceptFetch(trackedBase)
    : trackedBase;

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
    const trackedFetch = configuredSseFetch
      ? withTracking(withChallengeObserver(configuredSseFetch))
      : fetchWithOptionalAuthIntercept;

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

    const transport = new SSEClientTransport(url, {
      authProvider,
      eventSourceInit,
      requestInit,
      fetch: fetchWithOptionalAuthIntercept,
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

    // Both wrappers sit above the tracker. Header stamping, so the tracker
    // records the headers actually sent (#2385); stream suppression outermost
    // of all, so a suppressed GET is answered before it reaches the tracker —
    // it is never sent, and the Network log should not show a request the
    // server never saw (#2317). They touch disjoint requests (notification
    // POSTs vs. the endpoint's SSE GET), so their relative order is free.
    const stampedFetch = createNotificationHeadersFetch(
      fetchWithOptionalAuthIntercept,
    );
    const httpFetch =
      settings?.suppressNotificationStream === true
        ? createSuppressNotificationStreamFetch(stampedFetch, url)
        : stampedFetch;

    const transport = new StreamableHTTPClientTransport(url, {
      authProvider,
      requestInit,
      fetch: httpFetch,
      // SEP-2350: how the transport reacts to a `403 insufficient_scope`
      // challenge. Defaults to the SDK's `reauthorize` when unset.
      ...(settings?.oauthOnInsufficientScope && {
        onInsufficientScope: settings.oauthOnInsufficientScope,
      }),
    });

    return { transport };
  }
}
