import { getMCPProxyAddress, getMCPProxyAuthToken } from "@/utils/configUtils";
import type { InspectorConfig } from "./configurationTypes";

interface ProxyFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * JSON body from POST /fetch when the proxy itself failed (auth, TLS, etc.),
 * not a mirrored upstream HTTP response.
 */
function messageFromProxyInfrastructureError(data: unknown): string | null {
  if (!isJsonObject(data)) {
    return null;
  }
  const rec = data;
  if (!("error" in rec) || "status" in rec) {
    return null;
  }
  if (typeof rec.message === "string") {
    return rec.message;
  }
  if (typeof rec.error === "string") {
    return rec.error;
  }
  return "Proxy fetch failed";
}

/**
 * Validates the JSON shape the proxy returns when it successfully forwarded
 * a request and is mirroring the upstream response.
 */
function parseMirroredUpstreamJson(data: unknown): ProxyFetchResponse | null {
  if (!isJsonObject(data)) {
    return null;
  }
  const rec = data;

  if (typeof rec.status !== "number") {
    return null;
  }
  if (typeof rec.body !== "string") {
    return null;
  }
  if (typeof rec.statusText !== "string") {
    return null;
  }
  if (typeof rec.ok !== "boolean") {
    return null;
  }
  if (rec.headers === null || typeof rec.headers !== "object") {
    return null;
  }
  if (Array.isArray(rec.headers)) {
    return null;
  }

  const headers: Record<string, string> = {};
  for (const [key, val] of Object.entries(rec.headers)) {
    if (typeof val !== "string") {
      return null;
    }
    headers[key] = val;
  }

  return {
    ok: rec.ok,
    status: rec.status,
    statusText: rec.statusText,
    headers,
    body: rec.body,
  };
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
    const requestInput = input instanceof Request ? input : undefined;
    const url =
      typeof input === "string"
        ? input
        : requestInput
          ? requestInput.url
          : input.toString();

    // Serialize body for JSON transport. URLSearchParams and similar don't
    // JSON-serialize (they become {}), so we must convert to string first.
    let serializedBody: string | undefined;
    const requestBody =
      requestInput &&
      !requestInput.bodyUsed &&
      !["GET", "HEAD"].includes(requestInput.method)
        ? await requestInput.clone().text()
        : undefined;
    const effectiveBody = init?.body ?? requestBody;
    if (effectiveBody != null) {
      if (typeof effectiveBody === "string") {
        serializedBody = effectiveBody;
      } else if (effectiveBody instanceof URLSearchParams) {
        serializedBody = effectiveBody.toString();
      } else {
        serializedBody = String(effectiveBody);
      }
    }

    const forwardedHeaders = new Headers(requestInput?.headers);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => {
        forwardedHeaders.set(key, value);
      });
    }
    const serializedHeadersObject = Object.fromEntries(forwardedHeaders.entries());
    const serializedHeaders =
      Object.keys(serializedHeadersObject).length > 0
        ? serializedHeadersObject
        : undefined;

    const proxyResponse = await fetch(`${proxyAddress}/fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [header]: `Bearer ${token}`,
      },
      body: JSON.stringify({
        url,
        init: {
          method: init?.method ?? requestInput?.method,
          headers: serializedHeaders,
          body: serializedBody,
        },
      }),
    });

    let data: unknown;
    try {
      data = await proxyResponse.json();
    } catch {
      throw new Error(
        `Proxy fetch failed: ${proxyResponse.status} ${proxyResponse.statusText}`,
      );
    }

    const infraMessage = messageFromProxyInfrastructureError(data);
    if (infraMessage !== null) {
      throw new Error(infraMessage);
    }

    const mirrored = parseMirroredUpstreamJson(data);
    if (mirrored === null) {
      throw new Error("Proxy fetch failed: unexpected response shape");
    }

    return new Response(mirrored.body, {
      status: mirrored.status,
      statusText: mirrored.statusText,
      headers: new Headers(mirrored.headers),
    });
  };
}
