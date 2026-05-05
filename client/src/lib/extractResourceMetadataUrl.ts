/**
 * RFC 9728 helper: extract `resource_metadata=...` URL from auth-related
 * errors, regardless of which transport / connection mode produced them.
 *
 * Why: Inspector's proxy mode unwraps upstream 401s into JSON-RPC errors with
 * `data.upstream401.wwwAuthenticate`. The SDK transport never sees a 401, so
 * its `onUnauthorized` hook can't fire. Without the verbatim metadata URL,
 * `auth()` falls back to path-aware probes that 404 against resource servers
 * like AWS AgentCore (which exposes RFC 9728 metadata at the "suffix" path)
 * and the user is redirected to a bogus `<resource-host>/authorize`.
 *
 * Sources, in priority order:
 *   1. `error.resourceMetadataUrl` — set by the SDK transport on
 *      `UnauthorizedError` for direct 401s.
 *   2. `error.response.headers` or `error.headers` — `WWW-Authenticate` header
 *      on Sse/StreamableHTTP errors (duck-typed so this module is independent
 *      of the SDK's CJS auth bundle, which has Jest resolution issues).
 *   3. `error.data.upstream401.wwwAuthenticate` — the proxy-relayed envelope
 *      used when `connectionType === "proxy"`.
 *
 * Returns `undefined` when no advertised URL is available; callers fall back
 * to default discovery.
 */

function parseResourceMetadataFromWwwAuthenticate(
  wwwAuthenticate: unknown,
): URL | undefined {
  if (typeof wwwAuthenticate !== "string") return undefined;
  // RFC 9728 / RFC 6750: quoted-string preferred; bare token tolerated.
  const match = wwwAuthenticate.match(
    /resource_metadata\s*=\s*(?:"([^"]+)"|([^\s,]+))/i,
  );
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return undefined;
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractResourceMetadataUrlFromError(
  error: unknown,
): URL | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as {
    resourceMetadataUrl?: unknown;
    response?: { headers?: { get?: (k: string) => string | null } };
    headers?: Headers | unknown;
    data?: unknown;
  };

  // 1. SDK UnauthorizedError carries it directly
  const direct = e.resourceMetadataUrl;
  if (direct instanceof URL) return direct;
  if (typeof direct === "string") {
    try {
      return new URL(direct);
    } catch {
      /* fall through */
    }
  }

  // 2. WWW-Authenticate on the error (Sse/StreamableHTTP/fetch-style)
  const wwwAuth =
    e.response?.headers?.get?.("www-authenticate") ??
    (e.headers instanceof Headers
      ? e.headers.get("www-authenticate")
      : undefined);
  const fromHeader = parseResourceMetadataFromWwwAuthenticate(wwwAuth);
  if (fromHeader) return fromHeader;

  // 3. Proxy-relayed `upstream401` envelope (Inspector's proxy mode)
  if (
    isPlainObject(e.data) &&
    "upstream401" in e.data &&
    isPlainObject(e.data.upstream401)
  ) {
    return parseResourceMetadataFromWwwAuthenticate(
      e.data.upstream401.wwwAuthenticate,
    );
  }

  return undefined;
}
