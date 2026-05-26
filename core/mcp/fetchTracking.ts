import type { FetchRequestEntryBase } from "./types.js";

export interface FetchTrackingCallbacks {
  trackRequest?: (entry: FetchRequestEntryBase) => void;
  /**
   * Called after the response body has been read asynchronously. Lets the
   * consumer patch the already-dispatched entry with the body without
   * blocking the transport on body reading. Fires only on success — if the
   * body couldn't be read (long-lived stream, clone failure), this is
   * never invoked and the entry's responseBody stays undefined.
   */
  updateResponseBody?: (id: string, responseBody: string) => void;
}

/**
 * Creates a fetch wrapper that tracks HTTP requests and responses
 */
export function createFetchTracker(
  baseFetch: typeof fetch,
  callbacks: FetchTrackingCallbacks,
): typeof fetch {
  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const startTime = Date.now();
    const timestamp = new Date();
    const id = `${timestamp.getTime()}-${Math.random().toString(36).slice(2, 11)}`;

    // Extract request information
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init?.method || "GET";

    // Extract headers
    const requestHeaders: Record<string, string> = {};
    if (input instanceof Request) {
      input.headers.forEach((value, key) => {
        requestHeaders[key] = value;
      });
    }
    if (init?.headers) {
      const headers = new Headers(init.headers);
      headers.forEach((value, key) => {
        requestHeaders[key] = value;
      });
    }

    // Extract body (if present and readable)
    let requestBody: string | undefined;
    if (init?.body) {
      if (typeof init.body === "string") {
        requestBody = init.body;
      } else {
        // Try to convert to string, but skip if it fails (e.g., ReadableStream)
        try {
          requestBody = String(init.body);
        } catch {
          requestBody = undefined;
        }
      }
    } else if (input instanceof Request && input.body) {
      // Try to clone and read the request body
      // Clone protects the original body from being consumed
      try {
        const cloned = input.clone();
        requestBody = await cloned.text();
      } catch {
        // Can't read body (might be consumed, not readable, or other issue)
        requestBody = undefined;
      }
    }

    // Make the actual fetch request
    let response: Response;
    let error: string | undefined;
    try {
      response = await baseFetch(input, init);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      // Create a minimal error entry
      const entry: FetchRequestEntryBase = {
        id,
        timestamp,
        method,
        url,
        requestHeaders,
        requestBody,
        error,
        duration: Date.now() - startTime,
      };
      callbacks.trackRequest?.(entry);
      throw err;
    }

    // Extract response information
    const responseStatus = response.status;
    const responseStatusText = response.statusText;

    // Extract response headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // Skip body reading only for *long-lived* streams. On streamable HTTP,
    // GET /mcp opens an unbounded SSE channel for server-to-client pushes
    // — calling `.text()` on a clone of that would buffer forever. POST
    // responses with the same content-type are bounded: the server emits
    // the JSON-RPC reply (sometimes preceded by progress events) and
    // closes the connection, so cloning + reading is safe and gives the
    // user the raw SSE payload they were missing.
    const contentType = response.headers.get("content-type");
    const isLongLivedStream =
      method === "GET" &&
      (contentType?.includes("text/event-stream") ||
        contentType?.includes("application/x-ndjson"));

    const duration = Date.now() - startTime;

    // Create entry and track it immediately. The body is read asynchronously
    // below to avoid blocking the transport — for streaming responses (POST
    // + SSE), the server keeps the connection open until it has delivered
    // every progress notification plus the final reply, so awaiting
    // `.text()` here would force the transport to wait for all events
    // before it could process any of them.
    const entry: FetchRequestEntryBase = {
      id,
      timestamp,
      method,
      url,
      requestHeaders,
      requestBody,
      responseStatus,
      responseStatusText,
      responseHeaders,
      responseBody: undefined,
      duration,
    };

    callbacks.trackRequest?.(entry);

    // Kick off a fire-and-forget read of the cloned body. The clone is an
    // independent tee'd stream so the transport keeps consuming the
    // original at its own pace. When the read resolves we patch the entry
    // via `updateResponseBody`. Skipped for long-lived streams (GET +
    // SSE / ndjson) because `.text()` would never resolve on those.
    if (!isLongLivedStream && response.body && !response.bodyUsed) {
      try {
        const cloned = response.clone();
        cloned
          .text()
          .then((body) => {
            callbacks.updateResponseBody?.(id, body);
          })
          .catch(() => {
            // Stream errored after clone — leave the body undefined.
          });
      } catch {
        // Clone failed (consumed body, transport quirks). Leave body
        // undefined; the entry is already dispatched.
      }
    }

    return response;
  };
}
