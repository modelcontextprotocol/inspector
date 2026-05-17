import { OAuthStorageBase } from "../oauth-storage.js";
import { createOAuthStore } from "../store.js";
import { createFileStorageAdapter } from "../../storage/adapters/file-storage.js";
import {
  getDefaultStorageDir,
  getStoreFilePath,
} from "../../storage/store-io.js";

/** Default path: ~/.mcp-inspector/storage/oauth.json */
const DEFAULT_STATE_PATH = getStoreFilePath(getDefaultStorageDir(), "oauth");

/**
 * Get path to OAuth state file.
 * @param customPath - Optional custom path (full path to state file). Default: ~/.mcp-inspector/storage/oauth.json
 */
export function getStateFilePath(customPath?: string): string {
  return customPath ?? DEFAULT_STATE_PATH;
}

const storeCache = new Map<string, ReturnType<typeof createOAuthStore>>();

/**
 * Get or create the OAuth store instance for the given path.
 * @param stateFilePath - Optional custom path to state file. Default: ~/.mcp-inspector/storage/oauth.json
 */
export function getOAuthStore(stateFilePath?: string) {
  const key = getStateFilePath(stateFilePath);
  let store = storeCache.get(key);
  if (!store) {
    const filePath = getStateFilePath(stateFilePath);
    const storage = createFileStorageAdapter({ filePath });
    store = createOAuthStore(storage);
    storeCache.set(key, store);
  }
  return store;
}

/**
 * Clear all OAuth client state (all servers) in the default store.
 * Useful for test isolation in E2E OAuth tests.
 * Use a custom-path store and clear per serverUrl if you need to clear non-default storage.
 */
export function clearAllOAuthClientState(): void {
  const store = getOAuthStore();
  const state = store.getState();
  const urls = Object.keys(state.servers ?? {});
  for (const url of urls) {
    state.clearServerState(url);
  }
}

/**
 * Node.js storage implementation using Zustand with file-based persistence.
 * For InspectorClient, CLI, and TUI.
 */
export class NodeOAuthStorage extends OAuthStorageBase {
  /**
   * @param storagePath - Optional path to state file. Default: ~/.mcp-inspector/oauth/state.json
   */
  constructor(storagePath?: string) {
    super(getOAuthStore(storagePath));
  }
}
