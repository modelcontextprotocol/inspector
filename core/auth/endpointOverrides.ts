/**
 * Per-server authorization/token endpoint overrides (#1906).
 *
 * The Inspector deliberately has no fields for the authorization and token URLs
 * — they are resolved by authorization-server metadata discovery (RFC 8414 /
 * OpenID Connect Discovery), exactly as a real MCP host resolves them. But a
 * server under development often advertises its *production* authorization
 * server while the person debugging it wants the staging one, and discovery
 * gives them no way to say so.
 *
 * These overrides are that affordance: when set, they replace whatever the
 * authorization server's metadata document returned.
 *
 * ## Why this is a fetch wrapper and not a provider hook
 *
 * Both endpoints reach the flow through exactly one path in SDK v2: `auth()`
 * discovers the metadata document and then reads `metadata.authorization_endpoint`
 * (in `startAuthorization`) and `metadata.token_endpoint` (in `fetchToken`).
 * Neither is routed through `OAuthClientProvider`, and `AuthOptions` has no
 * `metadata` field — so the provider seam that carries the custom authorization
 * parameters (#2018) cannot reach the token endpoint at all. The one seam that
 * sees both is the `fetchFn` the SDK uses for discovery, so the override is
 * applied to the metadata document in flight.
 *
 * Four consequences worth knowing:
 *
 * - **A metadata document is required.** When discovery returns nothing, the SDK
 *   falls back to `/authorize` and `/token` on the authorization server's origin
 *   and there is no document to patch. That matches the feature as asked for —
 *   overriding "whatever urls the authorization server returns" — and a server
 *   publishing no metadata is already on a path where the endpoints are not
 *   being advertised in the first place.
 * - **They do not apply to the enterprise-managed (EMA) leg.** That flow
 *   authorizes against the enterprise IdP — a different authorization server —
 *   and its OIDC discovery runs through this same fetch, so `OAuthManager`
 *   suppresses the overrides when the server is enterprise-managed. This mirrors
 *   `redirectToExternalAuthorization` skipping the custom authorization
 *   parameters (#2018).
 * - **They redirect endpoints, they do not re-point the issuer.** `issuer` is
 *   left exactly as discovery returned it, deliberately: it is the authorization
 *   server's *identity*, and it is what RFC 9207 / SEP-2352 check the callback's
 *   `iss` against to defend against an authorization-server mix-up. So these
 *   overrides fit alternate endpoints of the same logical issuer (a staging
 *   deployment fronting the same issuer, a local proxy). Aim one at an
 *   authorization server that advertises a *different* issuer and the callback
 *   is rejected as an issuer mismatch before the code is redeemed — which is the
 *   mix-up defense working. Suppressing that check to make the override "work"
 *   would trade a real security property for a debugging convenience, so the
 *   limit is documented rather than removed.
 * - **The Network tab shows the patched document.** The wrapper is applied to the
 *   base fetch, inside the request tracker, so what the tab renders is the
 *   metadata as the flow consumed it. That is the useful reading: it explains why
 *   the subsequent authorize/token requests went where they did.
 */

/**
 * Per-server overrides for the two endpoints an authorization server publishes.
 * Both are optional and independent — overriding only the token URL is a valid
 * configuration.
 */
export interface OAuthEndpointOverrides {
  /** Replaces `authorization_endpoint` in the discovered metadata. */
  authorizationUrl?: string;
  /** Replaces `token_endpoint` in the discovered metadata. */
  tokenUrl?: string;
}

/** Field name on the metadata document each override replaces. */
const OVERRIDE_FIELDS = {
  authorizationUrl: "authorization_endpoint",
  tokenUrl: "token_endpoint",
} as const;

/**
 * Validation message for one configured endpoint URL, or `undefined` when the
 * value is acceptable. A blank value is not an error — it means "no override".
 *
 * Only absolute `http:`/`https:` URLs are accepted: the value is written
 * straight into the metadata document, where the SDK passes it to `new URL(...)`
 * with no base — so a relative path would throw deep inside the flow, far from
 * the setting that caused it. `http:` is allowed because the whole point is
 * reaching a local or staging authorization server.
 *
 * The settings form renders this message against the field, so the form and the
 * runtime cannot disagree about which values are usable.
 */
export function oauthEndpointUrlError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return `"${trimmed}" is not an absolute URL.`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `"${trimmed}" is not an http(s) URL.`;
  }
  // `new URL` accepts embedded credentials but Fetch rejects an HTTP(S) request
  // URL that carries them, so without this the value would pass both the form
  // and the runtime and then fail deep in the OAuth exchange — the failure mode
  // this validation exists to prevent. (Sending credentials to an endpoint the
  // flow discovered is not something to support quietly, either.)
  if (parsed.username || parsed.password) {
    return "URL must not contain a username or password.";
  }
  return undefined;
}

/**
 * The trimmed value, or `undefined` when it is blank or unusable. A rejected
 * value warns and is dropped rather than throwing, so one bad field cannot make
 * an otherwise-working server unconnectable.
 */
function normalizeEndpointUrl(
  value: string | undefined,
  field: keyof OAuthEndpointOverrides,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const error = oauthEndpointUrlError(trimmed);
  if (error) {
    console.warn(`[oauth] Ignoring \`${field}\`: ${error}`);
    return undefined;
  }
  return trimmed;
}

/**
 * Normalize the configured overrides, dropping blank and malformed values.
 * Returns `undefined` when nothing usable remains, which is the signal callers
 * use to skip wrapping their fetch at all.
 */
export function normalizeOAuthEndpointOverrides(
  overrides: OAuthEndpointOverrides | undefined,
): OAuthEndpointOverrides | undefined {
  if (!overrides) return undefined;
  const authorizationUrl = normalizeEndpointUrl(
    overrides.authorizationUrl,
    "authorizationUrl",
  );
  const tokenUrl = normalizeEndpointUrl(overrides.tokenUrl, "tokenUrl");
  if (!authorizationUrl && !tokenUrl) return undefined;
  return {
    ...(authorizationUrl && { authorizationUrl }),
    ...(tokenUrl && { tokenUrl }),
  };
}

/**
 * Whether a parsed JSON body is an authorization-server metadata document.
 *
 * The wrapper sees every JSON response on the connection, so this has to be
 * narrow enough not to rewrite an unrelated body that happens to carry a
 * similarly-named field. RFC 8414 §2 makes `issuer` REQUIRED and it appears in
 * no other document the flow fetches (protected-resource metadata has
 * `authorization_servers`, not `issuer`), so requiring `issuer` alongside at
 * least one of the two endpoints is a precise test.
 */
export function isAuthorizationServerMetadata(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const doc = value as Record<string, unknown>;
  if (typeof doc.issuer !== "string") return false;
  return (
    typeof doc.authorization_endpoint === "string" ||
    typeof doc.token_endpoint === "string"
  );
}

/**
 * Return a copy of an authorization-server metadata document with the
 * configured endpoints replaced.
 *
 * An override is written even when the document does not advertise that
 * endpoint: a metadata document missing `authorization_endpoint` already fails
 * the flow (`new URL(undefined)` throws), so supplying the missing value is
 * strictly better than leaving the hole.
 */
export function applyOAuthEndpointOverrides(
  metadata: Record<string, unknown>,
  overrides: OAuthEndpointOverrides,
): Record<string, unknown> {
  const patched = { ...metadata };
  for (const [key, field] of Object.entries(OVERRIDE_FIELDS) as [
    keyof OAuthEndpointOverrides,
    (typeof OVERRIDE_FIELDS)[keyof OAuthEndpointOverrides],
  ][]) {
    const override = overrides[key];
    if (override) patched[field] = override;
  }
  return patched;
}

/**
 * The well-known paths authorization-server metadata is discovered at: RFC 8414
 * (§3.1, including the path-suffixed and path-prefixed variants the SDK's
 * `buildDiscoveryUrls` emits) and OpenID Connect Discovery. Matched as a
 * substring of the pathname so every variant is covered by two literals.
 */
const AS_METADATA_WELL_KNOWN_PATHS = [
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
] as const;

/** The request URL a `fetch` call was made with, in any of its three forms. */
function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Whether a request is an authorization-server metadata discovery request.
 *
 * This is what keeps the wrapper off the hot path. Without it, every successful
 * `application/json` response on the connection — every `tools/call` result, and
 * every resource payload on the direct CLI/TUI transports — would be buffered
 * and parsed a second time before the SDK could consume it, purely to discover
 * that it is not a metadata document. Gating on the discovery URL first means
 * ordinary traffic is untouched: one string test and the response is returned.
 *
 * A URL that will not parse falls back to testing the raw string, which is the
 * conservative direction — worst case a request is *considered*, and the
 * metadata predicate then rejects it.
 */
function isAuthorizationServerMetadataRequest(
  input: RequestInfo | URL,
): boolean {
  const raw = requestUrlOf(input);
  let pathname: string;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    pathname = raw;
  }
  return AS_METADATA_WELL_KNOWN_PATHS.some((path) => pathname.includes(path));
}

/**
 * Whether a `content-type` names a **whole JSON document** — something that can
 * be read to completion.
 *
 * This must be an exact media-type match, not a substring test for "json". The
 * streamable-HTTP transport's long-lived server-push channel can be served as
 * `application/x-ndjson` (see `isLongLivedStreamResponse` in
 * `core/mcp/fetchTracking.ts`), which is an unbounded stream: awaiting `.json()`
 * on a clone of it would never resolve, and since this wrapper awaits before
 * returning, the MCP connection would hang for as long as an override is
 * configured. Metadata documents are plain `application/json`, so the narrow
 * test loses nothing. The `+json` structured suffix is accepted for the same
 * reason it exists — it names a concrete document, not a stream.
 */
function isJsonDocumentResponse(contentType: string | null): boolean {
  if (!contentType) return false;
  // Strip parameters (`; charset=utf-8`) and compare the media type itself.
  const mediaType = contentType.split(";")[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

/** Rebuild a response around a replacement body, preserving status/headers. */
function responseWithBody(response: Response, body: string): Response {
  const headers = new Headers(response.headers);
  // The body length changes when an override is applied, and a stale
  // `content-length` on a synthesized `Response` is worse than none — consumers
  // read the body we hand them, not the header.
  headers.delete("content-length");
  // `fetch` already decoded the body, so the replacement is plain text and an
  // inherited `content-encoding` would describe an encoding it no longer has.
  headers.delete("content-encoding");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Wrap a `fetch` so authorization-server metadata responses carry the
 * configured endpoint overrides.
 *
 * `getOverrides` is called per request rather than captured once: the OAuth
 * config is mutable (a settings edit can change it without rebuilding the
 * client), and reading it lazily means a wrapped fetch never serves a stale
 * override. When it returns nothing the response is passed through untouched,
 * so the wrapper is inert for the overwhelmingly common unconfigured case.
 */
export function withOAuthEndpointOverrides(
  fetchFn: typeof fetch,
  getOverrides: () => OAuthEndpointOverrides | undefined,
): typeof fetch {
  // Normalization is memoized on the raw pair rather than run per request: it
  // warns about a malformed value, and every request on the connection passes
  // through here — so without this a single typo would log on every call.
  let lastKey: string | undefined;
  let lastNormalized: OAuthEndpointOverrides | undefined;

  const resolveOverrides = (): OAuthEndpointOverrides | undefined => {
    const raw = getOverrides();
    const key = JSON.stringify([raw?.authorizationUrl, raw?.tokenUrl]);
    if (key !== lastKey) {
      lastKey = key;
      lastNormalized = normalizeOAuthEndpointOverrides(raw);
    }
    return lastNormalized;
  };

  return async (input, init) => {
    const response = await fetchFn(input, init);
    const overrides = resolveOverrides();
    if (!overrides) return response;
    // Cheapest tests first: only a discovery request can carry the document
    // this wrapper rewrites, so ordinary traffic never reaches the clone below.
    if (!isAuthorizationServerMetadataRequest(input)) return response;
    if (!response.ok) return response;
    if (!isJsonDocumentResponse(response.headers.get("content-type")))
      return response;

    // Read through a clone so every path that does NOT patch can return the
    // caller's own `Response`, untouched. Rebuilding unconditionally would drop
    // native properties a synthesized `Response` cannot carry (`url`,
    // `redirected`, `type`) from responses this wrapper has no business
    // altering — and would throw outright on a body-less 204/205, whose status
    // Fetch forbids a body on. A clone also makes a non-JSON body a plain
    // parse failure with nothing consumed.
    let parsed: unknown;
    try {
      parsed = await response.clone().json();
    } catch {
      return response;
    }
    if (!isAuthorizationServerMetadata(parsed)) return response;
    return responseWithBody(
      response,
      JSON.stringify(applyOAuthEndpointOverrides(parsed, overrides)),
    );
  };
}
