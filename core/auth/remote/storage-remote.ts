/**
 * Remote HTTP storage implementation for OAuth state.
 * Uses Zustand with remote storage adapter (HTTP API).
 * For web clients that need to share state with Node apps.
 */

import { OAuthStorageBase } from "../oauth-storage.js";
import { createOAuthStore } from "../store.js";
import { createRemoteStorageAdapter } from "../../storage/adapters/remote-storage.js";

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
 * Remote HTTP storage implementation using Zustand with remote storage adapter.
 * Stores OAuth state via HTTP API (GET/POST/DELETE /api/storage/:storeId).
 * For web clients that need to share state with Node apps (TUI, CLI).
 */
export class RemoteOAuthStorage extends OAuthStorageBase {
  constructor(options: RemoteOAuthStorageOptions) {
    super(
      createOAuthStore(
        createRemoteStorageAdapter({
          baseUrl: options.baseUrl,
          storeId: options.storeId ?? "oauth",
          authToken: options.authToken,
          fetchFn: options.fetchFn,
        }),
      ),
    );
  }
}
