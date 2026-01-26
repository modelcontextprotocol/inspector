/**
 * Debug middleware for capturing HTTP request/response pairs with pause functionality.
 * Used by the auth debugger to show each OAuth request individually.
 */

export interface DebugRequestResponse {
  id: string;
  label: string;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body?: unknown;
  };
}

export type DebugMiddlewareCallback = (
  entry: DebugRequestResponse,
) => Promise<void>;

/**
 * Creates a fetch function that captures request/response pairs and pauses
 * after each request completes, waiting for the callback to resolve.
 *
 * @param onComplete - Callback invoked after each request/response. The flow
 *                     pauses until this promise resolves.
 * @returns A fetch-like function that can be passed to SDK auth functions.
 */
export function createDebugFetch(
  onComplete: DebugMiddlewareCallback,
): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method || "GET";

    // Make the actual request
    const response = await fetch(input, init);

    // Clone to read body without consuming
    const clonedResponse = response.clone();
    let responseBody: unknown;
    try {
      responseBody = await clonedResponse.json();
    } catch {
      try {
        responseBody = await clonedResponse.text();
      } catch {
        responseBody = null;
      }
    }

    // Parse request body if present
    let requestBody: unknown = undefined;
    if (init?.body) {
      requestBody = parseBody(init.body);
    }

    // Build entry and wait for user to continue
    const entry: DebugRequestResponse = {
      id: crypto.randomUUID(),
      label: inferLabel(url, method),
      request: {
        method,
        url,
        headers: headersToObject(init?.headers),
        body: requestBody,
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: headersToObject(response.headers),
        body: responseBody,
      },
    };

    await onComplete(entry); // Blocks until user clicks Continue

    return response;
  };
}

/**
 * Creates a raw label showing the HTTP method and path.
 */
function inferLabel(url: string, method: string): string {
  try {
    const parsed = new URL(url);
    return `${method} ${parsed.pathname}`;
  } catch {
    return `${method} ${url}`;
  }
}

/**
 * Converts various header formats to a plain object.
 */
function headersToObject(
  headers?: HeadersInit | Headers,
): Record<string, string> {
  if (!headers) return {};

  if (headers instanceof Headers) {
    const obj: Record<string, string> = {};
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return headers as Record<string, string>;
}

/**
 * Parses a request body into a displayable format.
 */
function parseBody(body: BodyInit | null | undefined): unknown {
  if (!body) return undefined;

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      // Check if it's URL-encoded form data
      if (body.includes("=") && body.includes("&")) {
        const params = new URLSearchParams(body);
        const obj: Record<string, string> = {};
        params.forEach((value, key) => {
          obj[key] = value;
        });
        return obj;
      }
      return body;
    }
  }

  if (body instanceof URLSearchParams) {
    const obj: Record<string, string> = {};
    body.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }

  return "[Binary or unsupported body type]";
}
