import type { FetchRequestEntry } from "./types.js";

export interface FetchTrackingCallbacks {
  trackRequest?: (entry: FetchRequestEntry) => void;
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
    const id = `${timestamp.getTime()}-${Math.random().toString(36).substr(2, 9)}`;

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
      } else if (init.body instanceof ReadableStream) {
        // For streams, we can't read them without consuming, so we'll skip
        requestBody = undefined;
      } else {
        try {
          requestBody = String(init.body);
        } catch {
          requestBody = undefined;
        }
      }
    } else if (input instanceof Request && input.body) {
      // Try to clone and read the request body
      try {
        const cloned = input.clone();
        requestBody = await cloned.text();
      } catch {
        // Can't read body, that's okay
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
      const entry: FetchRequestEntry = {
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

    // Try to read response body (clone so we don't consume it)
    let responseBody: string | undefined;
    const contentType = response.headers.get("content-type");
    const isStream =
      contentType?.includes("text/event-stream") ||
      contentType?.includes("application/x-ndjson");

    if (!isStream) {
      try {
        const cloned = response.clone();
        responseBody = await cloned.text();
      } catch {
        // Can't read body (might be consumed or not readable)
        responseBody = undefined;
      }
    } else {
      // For streams, we can't read them without consuming, so we'll skip
      responseBody = undefined;
    }

    const duration = Date.now() - startTime;

    // Create entry and track it
    const entry: FetchRequestEntry = {
      id,
      timestamp,
      method,
      url,
      requestHeaders,
      requestBody,
      responseStatus,
      responseStatusText,
      responseHeaders,
      responseBody,
      duration,
    };

    callbacks.trackRequest?.(entry);

    return response;
  };
}
