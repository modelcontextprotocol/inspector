import type { InspectorClientEnvironment } from "@modelcontextprotocol/inspector-core/mcp/index.js";
import {
  createRemoteTransport,
  createRemoteFetch,
  createRemoteLogger,
} from "@modelcontextprotocol/inspector-core/mcp/remote/index.js";
import {
  BrowserOAuthStorage,
  BrowserNavigation,
} from "@modelcontextprotocol/inspector-core/auth/browser/index.js";
import type { RedirectUrlProvider } from "@modelcontextprotocol/inspector-core/auth/index.js";

/**
 * Creates an InspectorClientEnvironment for the web client.
 * This factory provides all the environment-specific implementations needed
 * by InspectorClient in a browser environment:
 * - Inspector API transport (via Hono API server)
 * - Inspector API fetch (for OAuth, bypasses CORS)
 * - Inspector API logger (sends logs to server)
 * - Browser OAuth storage and navigation
 *
 * @param authToken - Auth token for authenticating with the Inspector API server
 * @param redirectUrlProvider - Provider for OAuth redirect URLs
 * @returns Complete InspectorClientEnvironment ready for InspectorClient
 */
export function createWebEnvironment(
  authToken: string | undefined,
  redirectUrlProvider: RedirectUrlProvider,
): InspectorClientEnvironment {
  const baseUrl = `${window.location.protocol}//${window.location.host}`;

  // Wrap fetch in a function to preserve 'this' context
  // Passing window.fetch directly causes "Illegal invocation" error
  const fetchFn: typeof fetch = (...args) => globalThis.fetch(...args);

  return {
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
    logger: createRemoteLogger({
      baseUrl,
      authToken,
      fetchFn,
    }),
    oauth: {
      storage: new BrowserOAuthStorage(),
      navigation: new BrowserNavigation(),
      redirectUrlProvider,
    },
  };
}
