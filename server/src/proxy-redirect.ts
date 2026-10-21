/**
 * Redirect-hop rules for the `/fetch` proxy's manual redirect loop.
 *
 * `safeProxyFetch` (index.ts) follows redirects itself, with
 * `redirect: "manual"`, so every hop can be re-validated against the SSRF
 * guard and pinned to the addresses it resolved. Taking redirects away from
 * the fetch library also took away the request rewriting the library did on
 * each hop, so that rewriting lives here, as one pure function per hop:
 *
 *  - **Credentials stay with their origin.** When a hop changes origin —
 *    scheme, host or port — `Authorization`, `Proxy-Authorization`, `Cookie`,
 *    `Cookie2` and `WWW-Authenticate` are dropped, matching the Fetch
 *    standard's "HTTP-redirect fetch" step and node-fetch's own redirect
 *    handling. An https→http downgrade is an origin change, so it is covered.
 *    Header names are compared case-insensitively.
 *  - **Method and body follow the Fetch standard.** A 301/302 turns a POST
 *    into a bodyless GET; a 303 turns anything but GET/HEAD into a bodyless
 *    GET; 307/308 keep both. When the body is dropped, the headers describing
 *    it go with it.
 *
 * Every hop gets a fresh headers object, so the caller's input is never
 * mutated and a header dropped on one hop cannot reappear on a later one.
 */

/** Headers that carry credentials and must not cross an origin boundary. */
const CREDENTIAL_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "cookie2",
  "www-authenticate",
]);

/**
 * Headers that describe the request body. They are dropped together with the
 * body, so a rewritten GET does not announce a body it no longer has (a stale
 * `Content-Length` would leave the upstream waiting for bytes never sent).
 */
const BODY_HEADERS = new Set([
  "content-type",
  "content-length",
  "content-encoding",
  "content-language",
  "content-location",
]);

export interface ProxyHopRequest {
  url: URL;
  method: string;
  body: string | undefined;
  headers: Record<string, string>;
}

/**
 * Copies the caller-supplied `init.headers` into a plain string record. The
 * route receives them as JSON, so anything that is not a string-valued plain
 * object entry is ignored rather than handed to the fetch library.
 */
export function normalizeProxyHeaders(raw: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return headers;
  }
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      headers[name] = value;
    }
  }
  return headers;
}

function withoutHeaders(
  headers: Record<string, string>,
  names: ReadonlySet<string>,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!names.has(name.toLowerCase())) {
      kept[name] = value;
    }
  }
  return kept;
}

/**
 * Whether the Fetch standard rewrites this redirect into a bodyless GET:
 * 301/302 do so for POST only, 303 for every method except GET and HEAD.
 */
function rewritesToGet(status: number, method: string): boolean {
  const upper = method.toUpperCase();
  if (status === 301 || status === 302) {
    return upper === "POST";
  }
  if (status === 303) {
    return upper !== "GET" && upper !== "HEAD";
  }
  return false;
}

/**
 * Builds the request for the hop that follows a redirect response.
 *
 * @param current  the request that just received the redirect
 * @param status   the redirect response's status code
 * @param location the redirect response's `Location` header value
 * @returns the next hop's request; the SSRF guard still has to validate its
 *          URL before it is fetched
 */
export function nextRedirectRequest(
  current: ProxyHopRequest,
  status: number,
  location: string,
): ProxyHopRequest {
  const url = new URL(location, current.url);
  let { method, body } = current;
  let headers = { ...current.headers };

  if (url.origin !== current.url.origin) {
    headers = withoutHeaders(headers, CREDENTIAL_HEADERS);
  }

  if (rewritesToGet(status, method)) {
    method = "GET";
    body = undefined;
    headers = withoutHeaders(headers, BODY_HEADERS);
  }

  return { url, method, body, headers };
}
