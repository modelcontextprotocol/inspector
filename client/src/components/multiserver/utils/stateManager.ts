/**
 * State management utilities for multi-server persistence and restoration
 * Handles merging localStorage state with API state with proper cache invalidation
 */

import {
  ServerConfig,
  ServerStatus,
  CacheMetadata,
  PersistedMultiServerState,
} from "../types/multiserver";
import {
  loadMultiServerState,
  saveMultiServerState,
  loadEnhancedMultiServerState,
} from "./localStorage";

/**
 * Check if cache is trustworthy based on metadata and invalidation events
 */
export function shouldTrustCache(cacheMetadata: CacheMetadata): boolean {
  const now = Date.now();
  const maxCacheAge = 5 * 60 * 1000; // 5 minutes

  // Don't trust very old cache
  if (now - cacheMetadata.lastApiSync > maxCacheAge) {
    return false;
  }

  // Don't trust cache with recent deletion events
  const recentDeletions = cacheMetadata.invalidationEvents.filter(
    (event) =>
      event.type === "server_deleted" && now - event.timestamp < maxCacheAge,
  );

  if (recentDeletions.length > 0) {
    return false;
  }

  return true;
}

/**
 * Clean up servers that don't exist in API but are in cache
 */
export function cleanupStaleServers(
  cachedServers: ServerConfig[],
  apiServers: ServerConfig[],
): ServerConfig[] {
  const apiServerIds = new Set(apiServers.map((server) => server.id));
  return cachedServers.filter((server) => apiServerIds.has(server.id));
}

/**
 * Merge localStorage state with API state intelligently
 * NOW PRIORITIZES API DATA to prevent deleted servers from reappearing
 */
export function mergeServerStates(
  apiServers: ServerConfig[] = [],
  apiStatuses: Map<string, ServerStatus> = new Map(),
  persistedState: PersistedMultiServerState | null,
): {
  servers: ServerConfig[];
  statuses: Map<string, ServerStatus>;
  selectedServerId: string | null;
} {
  // If no persisted state, just use API data
  if (!persistedState) {
    return {
      servers: apiServers,
      statuses: apiStatuses,
      selectedServerId: null,
    };
  }

  // Load enhanced state to check cache metadata
  const enhancedState = loadEnhancedMultiServerState();

  // If we have enhanced state with cache metadata, validate it
  if (enhancedState && enhancedState.cacheMetadata) {
    if (!shouldTrustCache(enhancedState.cacheMetadata)) {
      // Don't trust the cache, use API data with minimal merge
      const apiServerMap = new Map(
        apiServers.map((server) => [server.id, server]),
      );
      const validSelectedId =
        persistedState.selectedServerId &&
        apiServerMap.has(persistedState.selectedServerId)
          ? persistedState.selectedServerId
          : null;

      return {
        servers: apiServers,
        statuses: apiStatuses,
        selectedServerId: validSelectedId,
      };
    }
  }

  // CRITICAL FIX: Start with API servers as the source of truth
  // Only add cached servers that still exist in the API
  const apiServerMap = new Map(apiServers.map((server) => [server.id, server]));
  const cachedServerMap = new Map(
    persistedState.servers.map((server) => [server.id, server]),
  );

  const mergedServers: ServerConfig[] = [];
  const mergedStatuses = new Map(apiStatuses);

  // First, add all API servers (this ensures deleted servers don't reappear)
  for (const apiServer of apiServers) {
    const cachedServer = cachedServerMap.get(apiServer.id);
    if (cachedServer) {
      // Merge API server with any cached configuration preferences
      mergedServers.push({
        ...cachedServer,
        ...apiServer, // API data takes precedence
        // Preserve certain cached fields that might not be in API
        updatedAt: apiServer.updatedAt || cachedServer.updatedAt,
      });
    } else {
      // New server from API
      mergedServers.push(apiServer);
    }
  }

  // Add cached statuses for servers that exist in the merged list
  for (const [serverId, status] of Object.entries(persistedState.statuses)) {
    if (apiServerMap.has(serverId) && !mergedStatuses.has(serverId)) {
      mergedStatuses.set(serverId, status);
    }
  }

  // Validate selected server ID - only keep if server still exists
  const validSelectedId =
    persistedState.selectedServerId &&
    mergedServers.some((s) => s.id === persistedState.selectedServerId)
      ? persistedState.selectedServerId
      : null;

  return {
    servers: mergedServers,
    statuses: mergedStatuses,
    selectedServerId: validSelectedId,
  };
}

/**
 * Restore multi-server state from localStorage with fallback
 */
export function restoreMultiServerState(): {
  servers: ServerConfig[];
  statuses: Map<string, ServerStatus>;
  selectedServerId: string | null;
} | null {
  try {
    const persistedState = loadMultiServerState();
    if (!persistedState) {
      return null;
    }

    // Convert statuses back to Map
    const statusMap = new Map(Object.entries(persistedState.statuses));

    return {
      servers: persistedState.servers,
      statuses: statusMap,
      selectedServerId: persistedState.selectedServerId,
    };
  } catch (error) {
    console.warn("Failed to restore multi-server state:", error);
    return null;
  }
}

/**
 * Persist current multi-server state
 */
export function persistMultiServerState(
  servers: ServerConfig[],
  statuses: Map<string, ServerStatus>,
  selectedServerId: string | null,
): void {
  try {
    // Only persist if we have meaningful data
    if (servers.length > 0) {
      saveMultiServerState(servers, statuses, selectedServerId);
    }
  } catch (error) {
    console.warn("Failed to persist multi-server state:", error);
    // Continue without persistence - graceful degradation
  }
}

/**
 * Check if state has meaningful data worth persisting
 */
export function shouldPersistState(servers: ServerConfig[]): boolean {
  return servers.length > 0;
}
