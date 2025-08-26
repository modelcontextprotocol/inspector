/**
 * Tests for cache invalidation functionality
 * Verifies that deleted servers don't reappear when switching modes
 */

import {
  saveMultiServerState,
  loadEnhancedMultiServerState,
  invalidateServerCache,
} from "../utils/localStorage";
import {
  mergeServerStates,
  shouldTrustCache,
  cleanupStaleServers,
} from "../utils/stateManager";
import {
  ServerConfig,
  ServerStatus,
  CacheMetadata,
} from "../types/multiserver";

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: mockLocalStorage,
});

// Test data
const mockServer1: ServerConfig = {
  id: "server-1",
  name: "Test Server 1",
  transportType: "stdio",
  config: {
    command: "test-command",
    args: [],
    env: {},
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockServer2: ServerConfig = {
  id: "server-2",
  name: "Test Server 2",
  transportType: "stdio",
  config: {
    command: "test-command-2",
    args: [],
    env: {},
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockStatus1: ServerStatus = {
  id: "server-1",
  status: "disconnected",
};

const mockStatus2: ServerStatus = {
  id: "server-2",
  status: "connected",
};

describe("Cache Invalidation", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  describe("Cache Metadata", () => {
    it("should create cache metadata when saving state", () => {
      const servers = [mockServer1, mockServer2];
      const statuses = new Map([
        ["server-1", mockStatus1],
        ["server-2", mockStatus2],
      ]);

      saveMultiServerState(servers, statuses, "server-1");

      const loadedState = loadEnhancedMultiServerState();
      expect(loadedState).toBeTruthy();
      expect(loadedState!.cacheMetadata).toBeTruthy();
      expect(loadedState!.cacheMetadata.version).toBe(1);
      expect(loadedState!.cacheMetadata.invalidationEvents).toEqual([]);
    });

    it("should trust fresh cache without invalidation events", () => {
      const now = Date.now();
      const metadata: CacheMetadata = {
        lastApiSync: now,
        invalidationEvents: [],
        version: 1,
      };

      expect(shouldTrustCache(metadata)).toBe(true);
    });

    it("should not trust old cache", () => {
      const oldTime = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      const metadata: CacheMetadata = {
        lastApiSync: oldTime,
        invalidationEvents: [],
        version: 1,
      };

      expect(shouldTrustCache(metadata)).toBe(false);
    });

    it("should not trust cache with recent deletion events", () => {
      const now = Date.now();
      const metadata: CacheMetadata = {
        lastApiSync: now,
        invalidationEvents: [
          {
            type: "server_deleted",
            serverId: "server-1",
            timestamp: now - 1000, // 1 second ago
          },
        ],
        version: 1,
      };

      expect(shouldTrustCache(metadata)).toBe(false);
    });
  });

  describe("Server Cache Invalidation", () => {
    it("should invalidate server cache and remove server", () => {
      // Setup initial state with two servers
      const servers = [mockServer1, mockServer2];
      const statuses = new Map([
        ["server-1", mockStatus1],
        ["server-2", mockStatus2],
      ]);

      saveMultiServerState(servers, statuses, "server-1");

      // Verify initial state
      let loadedState = loadEnhancedMultiServerState();
      expect(loadedState!.servers).toHaveLength(2);
      expect(loadedState!.selectedServerId).toBe("server-1");

      // Invalidate server-1
      invalidateServerCache("server-1");

      // Verify server was removed and invalidation event was recorded
      loadedState = loadEnhancedMultiServerState();
      expect(loadedState!.servers).toHaveLength(1);
      expect(loadedState!.servers[0].id).toBe("server-2");
      expect(loadedState!.selectedServerId).toBeNull(); // Should be cleared since deleted server was selected
      expect(loadedState!.cacheMetadata.invalidationEvents).toHaveLength(1);
      expect(loadedState!.cacheMetadata.invalidationEvents[0].type).toBe(
        "server_deleted",
      );
      expect(loadedState!.cacheMetadata.invalidationEvents[0].serverId).toBe(
        "server-1",
      );
    });
  });

  describe("State Merging with Cache Invalidation", () => {
    it("should prioritize API data when cache is not trusted", () => {
      // Setup cached state with invalidated server
      const cachedServers = [mockServer1, mockServer2];
      const cachedStatuses = new Map([
        ["server-1", mockStatus1],
        ["server-2", mockStatus2],
      ]);

      saveMultiServerState(cachedServers, cachedStatuses, "server-1");
      invalidateServerCache("server-1"); // Invalidate server-1

      // API only has server-2 (server-1 was deleted)
      const apiServers = [mockServer2];
      const apiStatuses = new Map([["server-2", mockStatus2]]);

      // Load cached state for merging
      const cachedState = loadEnhancedMultiServerState();
      const persistedState = {
        servers: cachedState!.servers,
        statuses: cachedState!.statuses || {},
        selectedServerId: cachedState!.selectedServerId,
        lastUpdated: cachedState!.lastUpdated,
      };

      // Merge should prioritize API data due to cache invalidation
      const mergedState = mergeServerStates(
        apiServers,
        apiStatuses,
        persistedState,
      );

      // Should only have server-2 (server-1 should not reappear)
      expect(mergedState.servers).toHaveLength(1);
      expect(mergedState.servers[0].id).toBe("server-2");
      expect(mergedState.selectedServerId).toBeNull(); // Should be cleared
    });

    it("should merge normally when cache is trusted", () => {
      // Setup fresh cached state without invalidation
      const cachedServers = [mockServer1, mockServer2];
      const cachedStatuses = new Map([
        ["server-1", mockStatus1],
        ["server-2", mockStatus2],
      ]);

      saveMultiServerState(cachedServers, cachedStatuses, "server-1");

      // API has both servers
      const apiServers = [mockServer1, mockServer2];
      const apiStatuses = new Map([
        ["server-1", mockStatus1],
        ["server-2", mockStatus2],
      ]);

      // Load cached state for merging
      const cachedState = loadEnhancedMultiServerState();
      const persistedState = {
        servers: cachedState!.servers,
        statuses: cachedState!.statuses || {},
        selectedServerId: cachedState!.selectedServerId,
        lastUpdated: cachedState!.lastUpdated,
      };

      // Merge should work normally
      const mergedState = mergeServerStates(
        apiServers,
        apiStatuses,
        persistedState,
      );

      // Should have both servers
      expect(mergedState.servers).toHaveLength(2);
      expect(mergedState.selectedServerId).toBe("server-1");
    });
  });

  describe("Stale Server Cleanup", () => {
    it("should remove servers that exist in cache but not in API", () => {
      const cachedServers = [mockServer1, mockServer2];
      const apiServers = [mockServer2]; // Only server-2 exists in API

      const cleanedServers = cleanupStaleServers(cachedServers, apiServers);

      expect(cleanedServers).toHaveLength(1);
      expect(cleanedServers[0].id).toBe("server-2");
    });

    it("should keep all servers when they exist in both cache and API", () => {
      const cachedServers = [mockServer1, mockServer2];
      const apiServers = [mockServer1, mockServer2];

      const cleanedServers = cleanupStaleServers(cachedServers, apiServers);

      expect(cleanedServers).toHaveLength(2);
    });
  });
});
