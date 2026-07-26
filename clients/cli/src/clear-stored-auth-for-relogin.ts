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
 *
 * Clears **both** the raw URL and the `new URL().href`-normalised form. Runtime
 * OAuth storage is keyed by the transport's raw `url` string, while some writers
 * (and earlier clear paths) use the normalised key — mirroring
 * `findStoredServerState` in `cli.ts`, which already tries both on read.
 */
export async function clearStoredAuthForRelogin(
  serverUrl: string | undefined,
): Promise<void> {
  if (!serverUrl?.trim()) return;
  const raw = serverUrl.trim();
  const normalized = normalizeServerUrl(raw);
  const storage = new NodeOAuthStorage();
  await storage.clear(raw);
  if (normalized !== raw) {
    await storage.clear(normalized);
  }
  // Drop the in-process singleton so the next connect cannot reuse a cleared
  // entry from the NodeOAuthStorage cache.
  resetNodeOAuthStorageCache();
}
