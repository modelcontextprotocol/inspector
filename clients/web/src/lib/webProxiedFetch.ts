import { createRemoteFetch } from "@inspector/core/mcp/remote/index.js";

let cached: { cacheKey: string; fetchFn: typeof fetch } | undefined;

const defaultFetch: typeof fetch = (...args) => globalThis.fetch(...args);

/**
 * The backend-proxied fetch the browser must use for any request aimed at an
 * authorization server rather than at the Inspector itself.
 *
 * `createWebEnvironment` hands the same thing to `InspectorClient`, so an OAuth
 * request made through a live client already travels this way. This exists for
 * the paths that have no client to borrow one from — clearing (and revoking)
 * the stored OAuth state of a server that is not the active connection.
 *
 * Going direct is not an option there: an authorization server serves no CORS
 * headers for a page origin it has never heard of, so `globalThis.fetch` would
 * fail on nearly every real deployment while working on a permissive one — the
 * worst shape of bug to carry.
 *
 * Cached as a cache of one, keyed the same way `getWebRemoteOAuthStorage` keys
 * its store: the web app has a stable origin and a page-lifetime API token, so
 * the key does not change within a session.
 */
export function getWebProxiedFetch(authToken?: string): typeof fetch {
  if (typeof window === "undefined") {
    throw new Error("getWebProxiedFetch requires a browser environment");
  }
  const baseUrl = `${window.location.protocol}//${window.location.host}`;
  const cacheKey = `${baseUrl}\0${authToken ?? ""}`;
  if (cached?.cacheKey === cacheKey) {
    return cached.fetchFn;
  }
  cached = {
    cacheKey,
    fetchFn: createRemoteFetch({ baseUrl, authToken, fetchFn: defaultFetch }),
  };
  return cached.fetchFn;
}

/** @internal Vitest isolation */
export function resetWebProxiedFetchCacheForTests(): void {
  cached = undefined;
}
