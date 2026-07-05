import { OAuthStorageBase } from "../oauth-storage.js";
import { OAuthMemoryStore } from "../store.js";
import { createSessionOAuthPersistBackend } from "../oauth-persist.js";

/**
 * Browser storage implementation using sessionStorage.
 * For web client (can be used by InspectorClient in browser).
 */
export class BrowserOAuthStorage extends OAuthStorageBase {
  constructor() {
    super(new OAuthMemoryStore(), createSessionOAuthPersistBackend());
  }
}

let sharedBrowserOAuthStorage: BrowserOAuthStorage | undefined;

/** Shared sessionStorage-backed OAuth store for the web client (single in-memory view). */
export function getBrowserOAuthStorage(): BrowserOAuthStorage {
  if (!sharedBrowserOAuthStorage) {
    sharedBrowserOAuthStorage = new BrowserOAuthStorage();
  }
  return sharedBrowserOAuthStorage;
}
