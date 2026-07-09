import { OAuthStorageBase } from "../oauth-storage.js";
import { OAuthMemoryStore } from "../store.js";
import { createFileOAuthPersistBackend } from "./oauth-persist-file.js";
import {
  getDefaultStorageDir,
  getStoreFilePath,
} from "../../storage/store-io.js";

/** Default path: ~/.mcp-inspector/storage/oauth.json */
const DEFAULT_STATE_PATH = getStoreFilePath(getDefaultStorageDir(), "oauth");

/**
 * Get path to OAuth state file. Resolution order: explicit `customPath`, then
 * the `MCP_INSPECTOR_OAUTH_STATE_PATH` environment variable (so tests and
 * scripted runs can point at an isolated fixture without touching
 * `~/.mcp-inspector`), then the default `~/.mcp-inspector/storage/oauth.json`.
 */
export function getStateFilePath(customPath?: string): string {
  return (
    customPath ??
    process.env.MCP_INSPECTOR_OAUTH_STATE_PATH ??
    DEFAULT_STATE_PATH
  );
}

const memoryCache = new Map<string, OAuthMemoryStore>();
const storageCache = new Map<string, NodeOAuthStorage>();

function getSharedMemory(stateFilePath?: string): OAuthMemoryStore {
  const key = getStateFilePath(stateFilePath);
  let memory = memoryCache.get(key);
  if (!memory) {
    memory = new OAuthMemoryStore();
    memoryCache.set(key, memory);
  }
  return memory;
}

/**
 * Drop cached in-memory and {@link NodeOAuthStorage} instances for a path.
 * @internal Test isolation only.
 */
export function resetNodeOAuthStorageCache(stateFilePath?: string): void {
  const key = getStateFilePath(stateFilePath);
  memoryCache.delete(key);
  storageCache.delete(key);
}

/**
 * Clear all OAuth client state (all servers) in the default store.
 * Useful for test isolation in E2E OAuth tests.
 * Use a custom-path store and clear per serverUrl if you need to clear non-default storage.
 */
export async function clearAllOAuthClientState(): Promise<void> {
  const storage = getNodeOAuthStorage();
  const filePath = getStateFilePath();
  const snapshot = await createFileOAuthPersistBackend({ filePath }).read();
  const urls = Object.keys(snapshot?.servers ?? {});
  for (const url of urls) {
    await storage.clear(url);
  }
}

/**
 * Node.js storage implementation with file-based persistence.
 * For InspectorClient, CLI, and TUI.
 */
export class NodeOAuthStorage extends OAuthStorageBase {
  /**
   * @param storagePath - Optional path to state file. Default: ~/.mcp-inspector/storage/oauth.json
   */
  constructor(storagePath?: string) {
    const filePath = getStateFilePath(storagePath);
    super(
      getSharedMemory(storagePath),
      createFileOAuthPersistBackend({ filePath }),
    );
  }
}

/** Cached NodeOAuthStorage instances keyed by resolved file path. */
function getNodeOAuthStorage(storagePath?: string): NodeOAuthStorage {
  const key = getStateFilePath(storagePath);
  let storage = storageCache.get(key);
  if (!storage) {
    storage = new NodeOAuthStorage(storagePath);
    storageCache.set(key, storage);
  }
  return storage;
}
