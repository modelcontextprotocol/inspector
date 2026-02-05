/**
 * Creates a fetch implementation that POSTs requests to the remote /api/fetch endpoint.
 * Use in the browser to bypass CORS for OAuth and MCP HTTP requests.
 */

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
      reqHeaders["x-mcp-remote-auth"] = options.authToken;
    }

    const res = await fetchFn(`${baseUrl}/api/fetch`, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify({ url, method, headers, body }),
    });

    if (!res.ok) {
      const text = await res.text();
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
