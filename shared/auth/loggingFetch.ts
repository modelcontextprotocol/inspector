import type pino from "pino";

/**
 * Creates a fetch wrapper that logs all OAuth HTTP requests and responses (discovery,
 * DCR, token exchange). Used for debugging auth flows.
 *
 * @param baseFetch - The underlying fetch implementation (default: global fetch)
 * @param logger - Pino logger instance
 * @returns A fetch function that logs auth requests and responses
 */
export function createLoggingFetch(
  baseFetch: typeof fetch = fetch,
  logger: pino.Logger,
): typeof fetch {
  return async function loggingFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    let requestBody: string;
    const body = init?.body;
    if (body == null) {
      requestBody = "[no body]";
    } else if (typeof body === "string") {
      requestBody = body;
    } else if (body instanceof URLSearchParams) {
      requestBody = body.toString();
    } else {
      requestBody = "[body not string or URLSearchParams]";
    }

    const requestHeaders: Record<string, string> = {};
    if (init?.headers) {
      const headers =
        init.headers instanceof Headers
          ? init.headers
          : new Headers(init.headers);
      headers.forEach((value, key) => {
        requestHeaders[key] = value;
      });
    }

    logger.info(
      {
        authFetchRequest: {
          url,
          method: init?.method ?? "GET",
          headers: requestHeaders,
          body: requestBody,
        },
      },
      "OAuth auth fetch request",
    );

    const response = await baseFetch(input, init);

    const clone = response.clone();
    let bodyText: string;
    try {
      bodyText = await clone.text();
    } catch (e) {
      bodyText = `[failed to read body: ${e instanceof Error ? e.message : String(e)}]`;
    }

    const headersObj: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headersObj[key] = value;
    });

    logger.info(
      {
        authFetchResponse: {
          url,
          status: response.status,
          statusText: response.statusText,
          headers: headersObj,
          body: bodyText,
        },
      },
      "OAuth auth fetch response",
    );

    return response;
  };
}
