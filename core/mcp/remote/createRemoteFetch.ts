/**
 * Creates a fetch implementation that POSTs requests to the remote /api/fetch endpoint.
 * Use in the browser to bypass CORS for OAuth and MCP HTTP requests.
 *
 * SEP-2243 header mirroring note (verified end-to-end against a modern server):
 * the modern Streamable HTTP client builds its mirrored headers *before* it
 * calls this fetch, and `serializeRequest` copies every request header verbatim
 * into the JSON payload, which the Node `/api/fetch` handler re-sends with
 * `new Headers(headers)`. So the proxy preserves whatever the SDK emits. But the
 * two header families are built differently in the SDK:
 *   - The STANDARD headers (`Mcp-Method` / `Mcp-Name` / `MCP-Protocol-Version`)
 *     are derived unconditionally from the request envelope, so they ARE present
 *     on the browser path and reach the server through this proxy.
 *   - The custom `Mcp-Param-*` headers are gated on a non-browser environment in
 *     the SDK (`detectProbeEnvironment() !== "browser"`, avoiding a CORS
 *     preflight), so the SDK never builds them here. The Inspector builds them
 *     itself instead (`mcpParamHeadersForTool`, #1846) — but they do NOT travel
 *     this path: they ride the transport's per-send `headers` through
 *     `/api/mcp/send`, where the Node backend applies them to the upstream
 *     request it issues. So an `x-mcp-header`-annotated tool IS callable from
 *     the web client against a strict modern server, same as from the CLI/TUI.
 */

import {
  isOAuthRequestTimeoutWire,
  OAuthRequestTimeoutError,
} from "../../auth/requestTimeout.js";

export interface RemoteFetchOptions {
  /** Base URL of the remote server (e.g. http://localhost:3000) */
  baseUrl: string;

  /** Optional auth token for x-mcp-remote-auth header */
  authToken?: string;

  /** Base fetch to use for the POST to the remote (default: globalThis.fetch) */
  fetchFn?: typeof fetch;
}

/**
 * Serialize request for the remote. Handles URLSearchParams body for OAuth token exchange.
 */
async function serializeRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
  const method =
    init?.method ??
    (typeof input === "object" && "method" in input
      ? (input as Request).method
      : "GET");

  const headers: Record<string, string> = {};
  if (input instanceof Request) {
    input.headers.forEach((v, k) => {
      headers[k] = v;
    });
  }
  if (init?.headers) {
    const h = new Headers(init.headers);
    h.forEach((v, k) => {
      headers[k] = v;
    });
  }

  let body: string | undefined;
  if (init?.body !== undefined && init?.body !== null) {
    if (typeof init.body === "string") {
      body = init.body;
    } else if (init.body instanceof URLSearchParams) {
      body = init.body.toString();
    } else if (init.body instanceof FormData) {
      const params = new URLSearchParams();
      for (const [key, value] of init.body.entries()) {
        if (typeof value === "string") {
          params.set(key, value);
        }
      }
      body = params.toString();
    } else {
      body = String(init.body);
    }
  } else if (input instanceof Request && input.body) {
    const cloned = input.clone();
    body = await cloned.text();
  }

  return { url, method, headers, body };
}

/**
 * Deserialize remote response into a Response object.
 */
function deserializeResponse(data: {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: string;
}): Response {
  return new Response(data.body ?? null, {
    status: data.status,
    statusText: data.statusText,
    headers: new Headers(data.headers ?? {}),
  });
}

/**
 * Returns a fetch function that forwards requests to the remote /api/fetch endpoint.
 * The remote server performs the actual HTTP request in Node (no CORS).
 */
export function createRemoteFetch(options: RemoteFetchOptions): typeof fetch {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const { url, method, headers, body } = await serializeRequest(input, init);

    const reqHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...headers,
    };
    if (options.authToken) {
      reqHeaders["x-mcp-remote-auth"] = `Bearer ${options.authToken}`;
    }

    // #2319: forward the caller's cancellation onto the proxy hop. Without it
    // an abort — including the OAuth deadline's own — settled only the caller's
    // promise: the POST stayed in flight, so the backend never saw its request
    // cancelled and its outbound fetch to the authorization server was left
    // running detached, holding a handler and a socket for as long as the
    // server cared to stall (Copilot). `init.signal` wins when present and not
    // `undefined` (a WebIDL dictionary member present as `undefined` converts
    // as absent), otherwise a `Request` carries its own.
    const explicitSignal = init?.signal;
    const signal =
      explicitSignal !== undefined
        ? (explicitSignal ?? undefined)
        : input instanceof Request
          ? input.signal
          : undefined;

    const res = await fetchFn(`${baseUrl}/api/fetch`, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify({ url, method, headers, body }),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      // A deadline the backend enforced arrives as an ordinary error response;
      // rebuild the typed error from its marker so the `instanceof` checks
      // downstream — most importantly the one that lets a stalled probe escape
      // `withRfc8414OidcCompat` — still see a timeout for what it is (#2319,
      // Copilot). This is the only path on which such a timeout can reach the
      // browser without a client-side wrapper having fired first: the discovery
      // the SDK runs from inside the transport has no wrapper at all.
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      if (isOAuthRequestTimeoutWire(parsed)) {
        throw new OAuthRequestTimeoutError(parsed.url, parsed.timeoutMs);
      }
      throw new Error(`Remote fetch failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      ok: boolean;
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body?: string;
    };

    return deserializeResponse(data);
  };
}
