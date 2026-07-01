import { RemoteOAuthStorage } from "@inspector/core/auth/remote/index.js";

/**
 * Shared `RemoteOAuthStorage` accessor for the web client.
 *
 * The browser's OAuth state is persisted through the in-process Hono backend
 * (`POST /api/storage/oauth` → `~/.mcp-inspector/storage/oauth.json`, mode
 * 0600) rather than `sessionStorage`, so a credential obtained in the browser
 * is the same blob the TUI/CLI read on the same host (web ⇄ TUI ⇄ CLI parity).
 *
 * One instance per `{baseUrl, authToken}`. The environment factory is called
 * per-connect (a fresh `InspectorClient` is built for each server switch), but
 * the OAuth blob on disk is a single shared resource: a stale instance's
 * whole-blob POST could clobber a write made by a newer one. Memoizing also
 * avoids re-hydrating the same file on every connect, and lets the connection
 * path, the EMA IdP hook, and the per-server "clear OAuth" action all share
 * one in-memory view of the store.
 */
const oauthStorageCache = new Map<string, RemoteOAuthStorage>();

/** Backend origin the web client talks to (same origin that serves the SPA). */
export function getWebOAuthBaseUrl(): string {
  return `${window.location.protocol}//${window.location.host}`;
}

/**
 * `window.fetch` loses its `this` binding when extracted, raising "Illegal
 * invocation"; wrap so the call site preserves the global receiver.
 */
export const webOAuthFetch: typeof fetch = (...args) =>
  globalThis.fetch(...args);

/**
 * Memoized `RemoteOAuthStorage` for the given backend + auth token.
 *
 * The cache key is intentionally `{baseUrl, authToken}` only — `fetchFn` is NOT
 * part of it. Whichever call constructs an instance first wins, so a later
 * caller's `fetchFn` is ignored. This is safe today because every call site
 * either omits `fetchFn` (defaulting to {@link webOAuthFetch}) or passes an
 * `environmentFactory` wrapper that is functionally identical (`globalThis.fetch`),
 * so the shared-instance goal (one whole-blob writer per backend) matters more
 * than which wrapper is used. A future caller needing a genuinely different
 * transport must key on it (or bypass the cache).
 */
export function getRemoteOAuthStorage(
  baseUrl: string,
  authToken: string | undefined,
  fetchFn: typeof fetch = webOAuthFetch,
): RemoteOAuthStorage {
  const key = `${baseUrl} ${authToken ?? ""}`;
  const cached = oauthStorageCache.get(key);
  if (cached) return cached;
  const storage = new RemoteOAuthStorage({ baseUrl, authToken, fetchFn });
  oauthStorageCache.set(key, storage);
  return storage;
}
