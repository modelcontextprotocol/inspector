/**
 * Remote HTTP storage implementation for OAuth state.
 * For web clients that need to share state with Node apps.
 */

import { OAuthStorageBase } from "../oauth-storage.js";
import { OAuthMemoryStore } from "../store.js";
import {
  createRemoteOAuthPersistBackend,
  OAUTH_PERSIST_STORE_ID,
} from "../oauth-persist.js";

export interface RemoteOAuthStorageOptions {
  /** Base URL of the remote server (e.g. http://localhost:3000) */
  baseUrl: string;
  /** Optional auth token for x-mcp-remote-auth header */
  authToken?: string;
  /** Fetch function to use (default: globalThis.fetch) */
  fetchFn?: typeof fetch;
}

/**
 * Remote HTTP storage implementation.
 * Stores OAuth state via the HTTP API (GET/POST/DELETE
 * /api/storage/oauth). The store id is fixed: OAuth state lives in the
 * one shared store the server gives split-secret and sectioned-write
 * semantics ({@link OAUTH_PERSIST_STORE_ID}) — a custom id would fail its
 * first sectioned write, since the server rejects sections on other stores.
 * For web clients that need to share state with Node apps (TUI, CLI).
 */
export class RemoteOAuthStorage extends OAuthStorageBase {
  constructor(options: RemoteOAuthStorageOptions) {
    super(
      new OAuthMemoryStore(),
      createRemoteOAuthPersistBackend({
        baseUrl: options.baseUrl,
        storeId: OAUTH_PERSIST_STORE_ID,
        authToken: options.authToken,
        fetchFn: options.fetchFn,
      }),
    );
  }
}
