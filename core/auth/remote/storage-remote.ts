/**
 * Remote HTTP storage implementation for OAuth state.
 * For web clients that need to share state with Node apps.
 */

import { OAuthStorageBase } from "../oauth-storage.js";
import { OAuthMemoryStore } from "../store.js";
import { createRemoteOAuthPersistBackend } from "../oauth-persist.js";

export interface RemoteOAuthStorageOptions {
  /** Base URL of the remote server (e.g. http://localhost:3000) */
  baseUrl: string;
  /** Store ID (default: "oauth") */
  storeId?: string;
  /** Optional auth token for x-mcp-remote-auth header */
  authToken?: string;
  /** Fetch function to use (default: globalThis.fetch) */
  fetchFn?: typeof fetch;
}

/**
 * Remote HTTP storage implementation.
 * Stores OAuth state via HTTP API (GET/POST/DELETE /api/storage/:storeId).
 * For web clients that need to share state with Node apps (TUI, CLI).
 */
export class RemoteOAuthStorage extends OAuthStorageBase {
  constructor(options: RemoteOAuthStorageOptions) {
    super(
      new OAuthMemoryStore(),
      createRemoteOAuthPersistBackend({
        baseUrl: options.baseUrl,
        storeId: options.storeId ?? "oauth",
        authToken: options.authToken,
        fetchFn: options.fetchFn,
      }),
    );
  }
}
