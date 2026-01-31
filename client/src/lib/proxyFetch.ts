import { getMCPProxyAddress, getMCPProxyAuthToken } from "@/utils/configUtils";
import type { InspectorConfig } from "./configurationTypes";

interface ProxyFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Creates a fetch function that routes requests through the proxy server
 * to avoid CORS restrictions on OAuth discovery and token endpoints.
 */
export function createProxyFetch(config: InspectorConfig): typeof fetch {
  const proxyAddress = getMCPProxyAddress(config);
  const { token, header } = getMCPProxyAuthToken(config);

  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();

    // Serialize body for JSON transport. URLSearchParams and similar don't
    // JSON-serialize (they become {}), so we must convert to string first.
    let serializedBody: string | undefined;
    if (init?.body != null) {
      if (typeof init.body === "string") {
        serializedBody = init.body;
      } else if (init.body instanceof URLSearchParams) {
        serializedBody = init.body.toString();
      } else {
        serializedBody = String(init.body);
      }
    }

    const proxyResponse = await fetch(`${proxyAddress}/fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [header]: `Bearer ${token}`,
      },
      body: JSON.stringify({
        url,
        init: {
          method: init?.method,
          headers: init?.headers
            ? Object.fromEntries(new Headers(init.headers))
            : undefined,
          body: serializedBody,
        },
      }),
    });

    if (!proxyResponse.ok) {
      throw new Error(`Proxy fetch failed: ${proxyResponse.statusText}`);
    }

    const data: ProxyFetchResponse = await proxyResponse.json();

    return new Response(data.body, {
      status: data.status,
      statusText: data.statusText,
      headers: new Headers(data.headers),
    });
  };
}
