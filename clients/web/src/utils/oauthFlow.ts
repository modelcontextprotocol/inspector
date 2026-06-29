/**
 * Shared constants and predicates for the browser-side OAuth authorization-code
 * flow wired into `App.tsx`. Extracted here so the pure logic is unit-testable
 * independently of the React component that orchestrates it.
 */

export { isUnauthorizedError } from "@inspector/core/auth/utils.js";

/**
 * The pathname the auth server redirects back to after the user authorizes.
 * `App.tsx`'s `redirectUrlProvider` points OAuth flows at
 * `${origin}${OAUTH_CALLBACK_PATH}`; the mount effect detects this pathname and
 * finishes the token exchange.
 */
export const OAUTH_CALLBACK_PATH = "/oauth/callback";

/**
 * sessionStorage key holding the id of the server whose OAuth flow is in
 * flight. The OAuth `state` parameter carries the auth session id; the full
 * configured server initiated the flow, and the full-page redirect to the auth
 * server wipes all in-memory React state. The id is stashed here right before
 * redirecting so the post-callback page load can rebuild the right
 * `InspectorClient` and resume the connection.
 */
export const OAUTH_PENDING_SERVER_KEY = "mcp-inspector:oauth-pending-server-id";
