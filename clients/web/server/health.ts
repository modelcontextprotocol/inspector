/**
 * The web backend's liveness/readiness endpoint, `GET /healthz` (#2438).
 *
 * An orchestrator (Docker, Kubernetes, a process manager) needs a cheap probe
 * that says "the backend is up" without exercising a real proxy/connect flow.
 * `GET /` works but reads `index.html` from disk and embeds the API token into
 * the response on every probe; this answers from memory and carries nothing.
 *
 * Three decisions, each deliberate:
 *
 * - **It lives outside `/api/*`, so it is unauthenticated.** Every `/api/*`
 *   route sits behind the `x-mcp-remote-auth` bearer check (and the origin
 *   allow-list), and a probe has no way to learn a token that is generated
 *   fresh per start. Putting the route under `/api` would mean carving an
 *   exception into that middleware; a top-level path needs none.
 * - **It discloses nothing beyond "up".** The body is a fixed
 *   `{"status":"ok"}` — no version, uptime, connected servers, config or
 *   storage state. An unauthenticated route is readable by anything that can
 *   reach the port (including a DNS-rebinding page, which the origin check
 *   does not cover outside `/api`), and a version string is a fingerprinting
 *   aid. "Is it running" is already answerable from `GET /`, so this adds no
 *   new information.
 * - **Liveness and readiness are the same answer here.** Both servers only
 *   start listening after the sandbox and app-origin listeners and the API app
 *   are fully constructed, so any response at all means the backend is ready.
 *
 * `Cache-Control: no-store` keeps an intermediary from answering a probe for a
 * backend that has since died.
 */

/** The path the health route is served at, in both the prod and dev backends. */
export const HEALTH_PATH = "/healthz";

/** The fixed health response body. Frozen: it is shared across requests. */
export const HEALTH_BODY: Readonly<{ status: "ok" }> = Object.freeze({
  status: "ok",
});

/** Response headers sent with every health response. */
export const HEALTH_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
});

/** Methods the route answers. `HEAD` is the cheapest probe some tools use. */
const HEALTH_METHODS = new Set(["GET", "HEAD"]);

/**
 * True when a raw request target (`req.url` — a path plus optional query, as
 * Node's `IncomingMessage` carries it) addresses the health route with a
 * method it answers. The query string is ignored, so a cache-busting probe
 * (`/healthz?t=…`) still matches; a trailing-slash or sub-path does not.
 */
export function isHealthRequest(
  method: string | undefined,
  url: string | undefined,
): boolean {
  if (!method || !HEALTH_METHODS.has(method.toUpperCase())) return false;
  const path = (url ?? "").split(/[?#]/, 1)[0];
  return path === HEALTH_PATH;
}

/**
 * Build the health response. `HEAD` gets the same status and headers with no
 * body, per HTTP semantics.
 */
export function healthResponse(method = "GET"): Response {
  const body =
    method.toUpperCase() === "HEAD" ? null : JSON.stringify(HEALTH_BODY);
  return new Response(body, { status: 200, headers: { ...HEALTH_HEADERS } });
}
