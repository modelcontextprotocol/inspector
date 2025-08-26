/**
 * localStorage utilities for multi-server state persistence
 * Follows the same pattern as single-server mode in App.tsx
 */

import {
  ServerConfig,
  ServerStatus,
  PersistedMultiServerState,
  EnhancedPersistedState,
  CacheMetadata,
  CacheInvalidationEvent,
} from "../types/multiserver";

const MULTI_SERVER_STORAGE_KEY = "mcp-inspector-multiserver-state";
const CACHE_VERSION = 1;

/**
 * Save multi-server state to localStorage with cache metadata
 * Similar to how App.tsx saves individual connection settings
 */
export function saveMultiServerState(
  servers: ServerConfig[],
  statuses: Map<string, ServerStatus>,
  selectedServerId: string | null,
  cacheMetadata?: CacheMetadata,
): void {
  try {
    const now = Date.now();

    // Create or update cache metadata
    const metadata: CacheMetadata = cacheMetadata || {
      lastApiSync: now,
      invalidationEvents: [],
      version: CACHE_VERSION,
    };

    const enhancedState: EnhancedPersistedState = {
      servers,
      statuses: Object.fromEntries(statuses),
      selectedServerId,
      lastUpdated: now,
      cacheMetadata: metadata,
    };

    const serialized = JSON.stringify(enhancedState);
    localStorage.setItem(MULTI_SERVER_STORAGE_KEY, serialized);
  } catch (error) {
    console.error("Failed to save multi-server state to localStorage:", error);
    // Graceful degradation - continue without persistence
  }
}

/**
 * Save multi-server state with enhanced cache metadata (backward compatible)
 */
export function saveMultiServerStateWithMetadata(
  servers: ServerConfig[],
  statuses: Map<string, ServerStatus>,
  selectedServerId: string | null,
  cacheMetadata: CacheMetadata,
): void {
  saveMultiServerState(servers, statuses, selectedServerId, cacheMetadata);
}

/**
 * Load multi-server state from localStorage with validation and cache metadata
 */
export function loadMultiServerState(): PersistedMultiServerState | null {
  try {
    const stored = localStorage.getItem(MULTI_SERVER_STORAGE_KEY);

    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as
      | EnhancedPersistedState
      | PersistedMultiServerState;

    // Validate structure
    if (!parsed || typeof parsed !== "object") {
      console.warn("Invalid multi-server state structure in localStorage");
      return null;
    }

    // Validate required fields
    if (!Array.isArray(parsed.servers) || typeof parsed.statuses !== "object") {
      console.warn("Invalid multi-server state data in localStorage");
      return null;
    }

    // Validate and migrate server configurations
    const validServers = parsed.servers
      .map((server: any) => {
        if (
          !server ||
          typeof server.id !== "string" ||
          typeof server.name !== "string" ||
          !server.transportType
        ) {
          console.warn(
            "Invalid server configuration found in localStorage:",
            server,
          );
          return null;
        }

        // Migrate legacy flat structure to nested config structure
        if (
          !server.config &&
          server.transportType === "stdio" &&
          server.command
        ) {
          return {
            ...server,
            config: {
              command: server.command,
              args: server.args || [],
              env: server.env || {},
            },
            // Remove flat properties
            command: undefined,
            args: undefined,
            env: undefined,
          };
        }

        if (
          !server.config &&
          server.transportType === "streamable-http" &&
          server.url
        ) {
          console.log(
            `Migrating legacy HTTP server configuration: ${server.id} (${server.name})`,
          );
          return {
            ...server,
            config: {
              url: server.url,
              headers: server.headers || {},
              bearerToken: server.bearerToken,
              headerName: server.headerName,
              oauthClientId: server.oauthClientId,
              oauthScope: server.oauthScope,
            },
            // Remove flat properties
            url: undefined,
            headers: undefined,
            bearerToken: undefined,
            headerName: undefined,
            oauthClientId: undefined,
            oauthScope: undefined,
          };
        }

        // Check if server has proper config structure
        if (!server.config) {
          console.warn("Server configuration missing config property:", server);
          return null;
        }

        return server;
      })
      .filter(
        (server: ServerConfig | null): server is ServerConfig =>
          server !== null,
      );

    return {
      servers: validServers,
      statuses: parsed.statuses || {},
      selectedServerId: parsed.selectedServerId || null,
      lastUpdated: parsed.lastUpdated || Date.now(),
    };
  } catch (error) {
    console.error(
      "Failed to load multi-server state from localStorage:",
      error,
    );
    return null;
  }
}

/**
 * Load enhanced multi-server state with cache metadata
 */
export function loadEnhancedMultiServerState(): EnhancedPersistedState | null {
  try {
    const stored = localStorage.getItem(MULTI_SERVER_STORAGE_KEY);

    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as EnhancedPersistedState;

    // Validate structure
    if (!parsed || typeof parsed !== "object") {
      console.warn("Invalid multi-server state structure in localStorage");
      return null;
    }

    // Validate required fields
    if (!Array.isArray(parsed.servers) || typeof parsed.statuses !== "object") {
      console.warn("Invalid multi-server state data in localStorage");
      return null;
    }

    // Handle backward compatibility - create default cache metadata if missing
    if (!parsed.cacheMetadata) {
      parsed.cacheMetadata = {
        lastApiSync: parsed.lastUpdated || Date.now(),
        invalidationEvents: [],
        version: CACHE_VERSION,
      };
    }

    // Validate cache metadata
    if (
      typeof parsed.cacheMetadata !== "object" ||
      typeof parsed.cacheMetadata.lastApiSync !== "number" ||
      !Array.isArray(parsed.cacheMetadata.invalidationEvents)
    ) {
      console.warn("Invalid cache metadata in localStorage, creating default");
      parsed.cacheMetadata = {
        lastApiSync: parsed.lastUpdated || Date.now(),
        invalidationEvents: [],
        version: CACHE_VERSION,
      };
    }

    // Validate and migrate server configurations (same as loadMultiServerState)
    const validServers = parsed.servers
      .map((server: any) => {
        if (
          !server ||
          typeof server.id !== "string" ||
          typeof server.name !== "string" ||
          !server.transportType
        ) {
          console.warn(
            "Invalid server configuration found in localStorage:",
            server,
          );
          return null;
        }

        // Migration logic (same as above)
        if (
          !server.config &&
          server.transportType === "stdio" &&
          server.command
        ) {
          return {
            ...server,
            config: {
              command: server.command,
              args: server.args || [],
              env: server.env || {},
            },
            command: undefined,
            args: undefined,
            env: undefined,
          };
        }

        if (
          !server.config &&
          server.transportType === "streamable-http" &&
          server.url
        ) {
          return {
            ...server,
            config: {
              url: server.url,
              headers: server.headers || {},
              bearerToken: server.bearerToken,
              headerName: server.headerName,
              oauthClientId: server.oauthClientId,
              oauthScope: server.oauthScope,
            },
            url: undefined,
            headers: undefined,
            bearerToken: undefined,
            headerName: undefined,
            oauthClientId: undefined,
            oauthScope: undefined,
          };
        }

        if (!server.config) {
          console.warn("Server configuration missing config property:", server);
          return null;
        }

        return server;
      })
      .filter(
        (server: ServerConfig | null): server is ServerConfig =>
          server !== null,
      );

    return {
      servers: validServers,
      statuses: parsed.statuses || {},
      selectedServerId: parsed.selectedServerId || null,
      lastUpdated: parsed.lastUpdated || Date.now(),
      cacheMetadata: parsed.cacheMetadata,
    };
  } catch (error) {
    console.error(
      "Failed to load enhanced multi-server state from localStorage:",
      error,
    );
    return null;
  }
}

/**
 * Clear multi-server state from localStorage
 */
export function clearMultiServerState(): void {
  try {
    localStorage.removeItem(MULTI_SERVER_STORAGE_KEY);
  } catch (error) {
    console.warn(
      "Failed to clear multi-server state from localStorage:",
      error,
    );
  }
}

/**
 * Invalidate server cache by marking it as deleted
 */
export function invalidateServerCache(serverId: string): void {
  try {
    const currentState = loadEnhancedMultiServerState();
    if (!currentState) {
      console.warn("No cached state found to invalidate");
      return;
    }

    // Add invalidation event
    const invalidationEvent: CacheInvalidationEvent = {
      type: "server_deleted",
      serverId,
      timestamp: Date.now(),
    };

    // Update cache metadata
    const updatedMetadata: CacheMetadata = {
      ...currentState.cacheMetadata,
      invalidationEvents: [
        ...currentState.cacheMetadata.invalidationEvents,
        invalidationEvent,
      ],
    };

    // Remove the server from cached servers
    const updatedServers = currentState.servers.filter(
      (server) => server.id !== serverId,
    );

    // Remove server status
    const updatedStatuses = { ...currentState.statuses };
    delete updatedStatuses[serverId];

    // Update selected server if it was the deleted one
    const updatedSelectedServerId =
      currentState.selectedServerId === serverId
        ? null
        : currentState.selectedServerId;

    // Save updated state
    saveMultiServerState(
      updatedServers,
      new Map(Object.entries(updatedStatuses)),
      updatedSelectedServerId,
      updatedMetadata,
    );
  } catch (error) {
    console.error("Failed to invalidate server cache:", error);
  }
}

/**
 * Check if localStorage is available and functional
 */
export function isLocalStorageAvailable(): boolean {
  try {
    const testKey = "__mcp_inspector_test__";
    localStorage.setItem(testKey, "test");
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}
