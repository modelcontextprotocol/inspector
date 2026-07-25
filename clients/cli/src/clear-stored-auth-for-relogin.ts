import {
  NodeOAuthStorage,
  resetNodeOAuthStorageCache,
} from "@inspector/core/auth/node/storage-node.js";

/** Same canonicalisation as CLI `normalizeServerUrl` (avoid cycles). */
function normalizeServerUrl(serverUrl: string): string {
  try {
    return new URL(serverUrl).href;
  } catch {
    return serverUrl;
  }
}

/**
 * Drop stored OAuth state for an HTTP(S) server URL so the next connect cannot
 * silently reuse tokens (`--relogin`). No-op when `serverUrl` is missing.
 */
export async function clearStoredAuthForRelogin(
  serverUrl: string | undefined,
): Promise<void> {
  if (!serverUrl?.trim()) return;
  const url = normalizeServerUrl(serverUrl.trim());
  const storage = new NodeOAuthStorage();
  await storage.clear(url);
  resetNodeOAuthStorageCache();
}
