import { RemoteOAuthStorage } from "@inspector/core/auth/remote/storage-remote.js";

export interface WebRemoteOAuthStorageOptions {
  baseUrl: string;
  authToken?: string;
}

let cached: { cacheKey: string; storage: RemoteOAuthStorage } | undefined;

function buildCacheKey(options: WebRemoteOAuthStorageOptions): string {
  return `${options.baseUrl}\0${options.authToken ?? ""}`;
}

const defaultFetch: typeof fetch = (...args) => globalThis.fetch(...args);

/**
 * Shared web OAuth store: `RemoteOAuthStorage` → `GET/POST /api/storage/oauth`
 * → `~/.mcp-inspector/storage/oauth.json` (same file as CLI/TUI).
 *
 * Caches a single instance keyed by `{ baseUrl, authToken }`: repeat calls with
 * the same key return that instance, so connect, EMA IdP session, and per-server
 * clear all mutate the same in-memory view. A call with a different key replaces
 * the cached instance (cache of one). That is sufficient because the web app
 * uses a stable origin + page-lifetime API token, so the key never changes
 * within a session.
 */
export function getRemoteOAuthStorage(
  options: WebRemoteOAuthStorageOptions,
): RemoteOAuthStorage {
  const cacheKey = buildCacheKey(options);
  if (cached?.cacheKey === cacheKey) {
    return cached.storage;
  }
  cached = {
    cacheKey,
    storage: new RemoteOAuthStorage({
      baseUrl: options.baseUrl,
      authToken: options.authToken,
      fetchFn: defaultFetch,
    }),
  };
  return cached.storage;
}

/** Current origin + optional API token (see `getAuthToken()` in App.tsx). */
export function getWebRemoteOAuthStorage(
  authToken?: string,
): RemoteOAuthStorage {
  if (typeof window === "undefined") {
    throw new Error("getWebRemoteOAuthStorage requires a browser environment");
  }
  const baseUrl = `${window.location.protocol}//${window.location.host}`;
  return getRemoteOAuthStorage({ baseUrl, authToken });
}

/** @internal Vitest isolation */
export function resetWebRemoteOAuthStorageCacheForTests(): void {
  cached = undefined;
}
