import type { InspectorClientEnvironment } from "@inspector/core/mcp/index.js";
import {
  createRemoteTransport,
  createRemoteFetch,
  createRemoteLogger,
} from "@inspector/core/mcp/remote/index.js";
import { BrowserNavigation } from "@inspector/core/auth/browser/index.js";
import type { RedirectUrlProvider } from "@inspector/core/auth/index.js";
import { getWebRemoteOAuthStorage } from "./remoteOAuthStorage.js";

export interface WebEnvironmentResult {
  environment: InspectorClientEnvironment;
  logger: InspectorClientEnvironment["logger"];
}

/**
 * Assemble an `InspectorClientEnvironment` for the browser:
 *   - transport / fetch / logger all routed through the in-process Hono
 *     backend at `window.location.origin` (the `clients/web/server`
 *     dev-backend wires this in `/api/*`).
 *   - OAuth storage uses `RemoteOAuthStorage` (shared `oauth.json` via
 *     `/api/storage/oauth`); navigation uses `BrowserNavigation`.
 *
 * Returns both the assembled environment and the logger so callers can share
 * the same pino instance for any direct logging they need to do, instead of
 * reaching back through the client.
 *
 * `authToken` is supplied by `App.tsx` (`getAuthToken()`) and forwarded to
 * remote transport/fetch/logger and `getWebRemoteOAuthStorage` so every
 * `/api/*` call (including `/api/storage/oauth`) carries `x-mcp-remote-auth`
 * when the backend requires it.
 *
 * `onBeforeOAuthRedirect` runs synchronously immediately before the OAuth
 * full-page redirect (see `BrowserNavigation`). The app uses it to flush the
 * pre-redirect Network log to backend storage so the auth handshake's first
 * half (discovery + Dynamic Client Registration) survives the navigation.
 */
export function createWebEnvironment(
  authToken: string | undefined,
  redirectUrlProvider: RedirectUrlProvider,
  onBeforeOAuthRedirect?: (authorizationUrl: URL) => void,
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
      storage: getWebRemoteOAuthStorage(authToken),
      navigation: new BrowserNavigation(undefined, onBeforeOAuthRedirect),
      redirectUrlProvider,
    },
  };

  return { environment, logger };
}
