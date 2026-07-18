import { extractWWWAuthenticateParams } from "@modelcontextprotocol/sdk/client/auth.js";
import { getServerSpecificKey, SESSION_KEYS } from "./constants";

function parseResourceMetadataUrl(value: string | null): URL | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

export function extractResourceMetadataUrlFromWWWAuthenticate(
  wwwAuthenticate: string | undefined,
): URL | undefined {
  if (!wwwAuthenticate) {
    return undefined;
  }

  const response = new Response(null, {
    headers: { "WWW-Authenticate": wwwAuthenticate },
  });
  return extractWWWAuthenticateParams(response).resourceMetadataUrl;
}

export function extractResourceMetadataUrlFromAuthError(
  error: unknown,
): URL | undefined {
  const data = (error as { data?: unknown })?.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return undefined;
  }

  const upstream401 = (data as { upstream401?: unknown }).upstream401;
  if (
    typeof upstream401 !== "object" ||
    upstream401 === null ||
    Array.isArray(upstream401)
  ) {
    return undefined;
  }

  const wwwAuthenticate = (upstream401 as { wwwAuthenticate?: unknown })
    .wwwAuthenticate;
  return typeof wwwAuthenticate === "string"
    ? extractResourceMetadataUrlFromWWWAuthenticate(wwwAuthenticate)
    : undefined;
}

export async function discoverResourceMetadataUrlFromServer(
  serverUrl: string,
  fetchFn?: typeof fetch,
): Promise<URL | undefined> {
  const effectiveFetch = fetchFn ?? globalThis.fetch;
  if (!effectiveFetch) {
    return undefined;
  }

  try {
    const response = await effectiveFetch(serverUrl, {
      headers: { Accept: "application/json, text/event-stream" },
    });
    const resourceMetadataUrl =
      response.status === 401 || response.status === 403
        ? extractResourceMetadataUrlFromWWWAuthenticate(
            response.headers.get("WWW-Authenticate") ?? undefined,
          )
        : undefined;
    try {
      await response.body?.cancel();
    } catch {
      // Best-effort cleanup must not discard an already discovered URL.
    }
    return resourceMetadataUrl;
  } catch {
    return undefined;
  }
}

export function saveResourceMetadataUrlToSessionStorage(
  serverUrl: string,
  resourceMetadataUrl: URL,
): void {
  sessionStorage.setItem(
    getServerSpecificKey(SESSION_KEYS.RESOURCE_METADATA_URL, serverUrl),
    resourceMetadataUrl.toString(),
  );
}

export function getResourceMetadataUrlFromSessionStorage(
  serverUrl: string,
): URL | undefined {
  return parseResourceMetadataUrl(
    sessionStorage.getItem(
      getServerSpecificKey(SESSION_KEYS.RESOURCE_METADATA_URL, serverUrl),
    ),
  );
}

export function clearResourceMetadataUrlFromSessionStorage(
  serverUrl: string,
): void {
  sessionStorage.removeItem(
    getServerSpecificKey(SESSION_KEYS.RESOURCE_METADATA_URL, serverUrl),
  );
}
