import {
  NodeOAuthStorage,
  resetNodeOAuthStorageCache,
} from "@inspector/core/auth/node/storage-node.js";

/** Same canonicalisation as one-shot `normalizeServerUrl` (avoid cycles). */
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
 *
 * Kept in the one-shot CLI package so `--relogin` does not depend on the mcpi
 * client (which owns the fuller `auth/list` / `auth/clear` surface).
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
