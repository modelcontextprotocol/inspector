import type { InspectorClientEnvironment } from "@inspector/core/mcp/index.js";
import {
  createRemoteTransport,
  createRemoteFetch,
  createRemoteLogger,
} from "@inspector/core/mcp/remote/index.js";
import {
  BrowserOAuthStorage,
  BrowserNavigation,
} from "@inspector/core/auth/browser/index.js";
import type { RedirectUrlProvider } from "@inspector/core/auth/index.js";

export interface WebEnvironmentResult {
  environment: InspectorClientEnvironment;
  logger: InspectorClientEnvironment["logger"];
}

/**
 * Assemble an `InspectorClientEnvironment` for the browser:
 *   - transport / fetch / logger all routed through the in-process Hono
 *     backend at `window.location.origin` (the `clients/web/server`
 *     dev-backend wires this in `/api/*`).
 *   - OAuth storage + navigation use the `BrowserOAuthStorage` (sessionStorage)
 *     and `BrowserNavigation` (full-page redirect) adapters.
 *
 * Returns both the assembled environment and the logger so callers can share
 * the same pino instance for any direct logging they need to do, instead of
 * reaching back through the client.
 *
 * `authToken` is read from a higher level (currently unused in this app since
 * v2 has no auth-token UI yet, but kept in the signature so the wiring is
 * ready when token plumbing lands).
 */
export function createWebEnvironment(
  authToken: string | undefined,
  redirectUrlProvider: RedirectUrlProvider,
): WebEnvironmentResult {
  const baseUrl = `${window.location.protocol}//${window.location.host}`;

  // Passing `window.fetch` directly raises "Illegal invocation" because the
  // function loses its `this` binding when extracted off `window`. Wrap so
  // the call site preserves the global receiver.
  const fetchFn: typeof fetch = (...args) => globalThis.fetch(...args);

  const logger = createRemoteLogger({
    baseUrl,
    authToken,
    fetchFn,
  });

  const environment: InspectorClientEnvironment = {
    transport: createRemoteTransport({
      baseUrl,
      authToken,
      fetchFn,
    }),
    fetch: createRemoteFetch({
      baseUrl,
      authToken,
      fetchFn,
    }),
    logger,
    oauth: {
      storage: new BrowserOAuthStorage(),
      navigation: new BrowserNavigation(),
      redirectUrlProvider,
    },
  };

  return { environment, logger };
}
