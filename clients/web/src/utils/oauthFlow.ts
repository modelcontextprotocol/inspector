/**
 * Shared constants and predicates for the browser-side OAuth authorization-code
 * flow wired into `App.tsx`. Extracted here so the pure logic is unit-testable
 * independently of the React component that orchestrates it.
 */

/**
 * The pathname the auth server redirects back to after the user authorizes.
 * `App.tsx`'s `redirectUrlProvider` points OAuth flows at
 * `${origin}${OAUTH_CALLBACK_PATH}`; the mount effect detects this pathname and
 * finishes the token exchange.
 */
export const OAUTH_CALLBACK_PATH = "/oauth/callback";

/**
 * sessionStorage key holding the id of the server whose OAuth flow is in
 * flight. The OAuth `state` parameter only carries `{mode}:{authId}`, not which
 * configured server initiated the flow, and the full-page redirect to the auth
 * server wipes all in-memory React state. The id is stashed here right before
 * redirecting so the post-callback page load can rebuild the right
 * `InspectorClient` and resume the connection.
 */
export const OAUTH_PENDING_SERVER_KEY = "mcp-inspector:oauth-pending-server-id";

/**
 * True when a thrown connect error represents an upstream 401. The remote
 * transport preserves the status on the error object
 * (`remoteClientTransport` sets `error.status`); this structured check is the
 * primary path. As a fallback for cases where the status is lost crossing an
 * SDK boundary, we match the transport's own formatted wording —
 * `"Remote (connect|send|events stream) failed (401): …"` — anchored on
 * `failed …(401)` rather than a bare `(401)`, so an unrelated `(401)` spliced
 * into an error message (e.g. from a tool result) can't trip the OAuth flow.
 * A 401 on connect to an HTTP/SSE server is the signal to start OAuth.
 */
export function isUnauthorizedError(err: unknown): boolean {
  if (typeof err === "object" && err !== null) {
    const status = (err as { status?: number; code?: number }).status;
    const code = (err as { code?: number }).code;
    if (status === 401 || code === 401) return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /\bfailed\b[^\n]*\(401\)/i.test(message);
}
