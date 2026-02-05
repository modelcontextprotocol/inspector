/**
 * Memory Stub Implementations
 *
 * In-memory implementations of repository and service interfaces.
 * Use for development, testing, or as a starting point for real implementations.
 * Data is lost when the process exits.
 */

import type {
  ServerConfigRepository,
  HistoryRepository,
  HistoryListOptions,
  LogsRepository,
  LogsListOptions,
  TestingProfileRepository,
} from './repositories.js';
import type {
  ConnectionService,
  ConnectionState,
  ConnectionOptions,
  ExecutionService,
  ExecutionState,
  PendingClientRequest,
  initialConnectionState,
  initialExecutionState,
} from './services.js';
import type { ServerConfig } from '../types/servers.js';
import type { HistoryEntry } from '../types/history.js';
import type { LogEntry, LOG_LEVELS } from '../types/logs.js';
import type { TestingProfile } from '../types/testingProfiles.js';
import type { ServerInfo } from '../client.js';
import {
  createMcpClient,
  connectClient,
  disconnectClient,
  createHttpTransport,
  createAuthenticatedTransport,
} from '../index.js';

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// Server Config Repository
// ============================================================================

/**
 * In-memory server config repository.
 */
export function createMemoryServerConfigRepository(): ServerConfigRepository {
  const configs = new Map<string, ServerConfig>();

  return {
    async list() {
      return Array.from(configs.values());
    },

    async get(id) {
      return configs.get(id);
    },

    async create(config) {
      const now = new Date().toISOString();
      const full: ServerConfig = {
        ...config,
        id: generateId('server'),
        createdAt: now,
        updatedAt: now,
        connectionMode: config.transport === 'http' ? 'direct' : 'proxy',
      };
      configs.set(full.id, full);
      return full;
    },

    async update(id, updates) {
      const existing = configs.get(id);
      if (!existing) {
        throw new Error(`Server config not found: ${id}`);
      }
      const updated: ServerConfig = {
        ...existing,
        ...updates,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      configs.set(id, updated);
      return updated;
    },

    async delete(id) {
      configs.delete(id);
    },

    async deleteAll() {
      configs.clear();
    },
  };
}

// ============================================================================
// History Repository
// ============================================================================

/**
 * In-memory history repository.
 */
export function createMemoryHistoryRepository(): HistoryRepository {
  const entries = new Map<string, HistoryEntry>();

  return {
    async list(options?: HistoryListOptions) {
      let result = Array.from(entries.values());

      // Filter by method
      if (options?.method) {
        result = result.filter((e) => e.method === options.method);
      }

      // Filter by request type
      if (options?.requestType) {
        result = result.filter((e) => e.requestType === options.requestType);
      }

      // Filter root only
      if (options?.rootOnly) {
        result = result.filter((e) => !e.parentRequestId);
      }

      // Sort by timestamp descending (newest first)
      result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      // Apply limit
      if (options?.limit && options.limit > 0) {
        result = result.slice(0, options.limit);
      }

      return result;
    },

    async get(id) {
      return entries.get(id);
    },

    async add(entry) {
      const full: HistoryEntry = {
        ...entry,
        id: generateId('req'),
        timestamp: new Date().toISOString(),
        pinned: false,
      };
      entries.set(full.id, full);
      return full;
    },

    async update(id, updates) {
      const existing = entries.get(id);
      if (!existing) {
        throw new Error(`History entry not found: ${id}`);
      }
      const updated: HistoryEntry = {
        ...existing,
        ...updates,
        id: existing.id,
        timestamp: existing.timestamp,
      };
      entries.set(id, updated);
      return updated;
    },

    async delete(id) {
      entries.delete(id);
    },

    async deleteAll(options) {
      if (options?.keepPinned) {
        for (const [id, entry] of entries) {
          if (!entry.pinned) {
            entries.delete(id);
          }
        }
      } else {
        entries.clear();
      }
    },

    async getChildren(parentRequestId) {
      return Array.from(entries.values()).filter(
        (e) => e.parentRequestId === parentRequestId
      );
    },
  };
}

// ============================================================================
// Logs Repository
// ============================================================================

/**
 * In-memory logs repository.
 */
export function createMemoryLogsRepository(): LogsRepository {
  const logs: LogEntry[] = [];
  const LOG_LEVEL_ORDER = [
    'debug',
    'info',
    'notice',
    'warning',
    'error',
    'critical',
    'alert',
    'emergency',
  ] as const;

  return {
    async list(options?: LogsListOptions) {
      let result = [...logs];

      // Filter by minimum level
      if (options?.minLevel) {
        const minIndex = LOG_LEVEL_ORDER.indexOf(options.minLevel);
        result = result.filter((log) => {
          const logIndex = LOG_LEVEL_ORDER.indexOf(
            log.level as (typeof LOG_LEVEL_ORDER)[number]
          );
          return logIndex >= minIndex;
        });
      }

      // Filter by logger
      if (options?.logger) {
        result = result.filter((log) => log.logger === options.logger);
      }

      // Filter by request ID
      if (options?.requestId) {
        result = result.filter((log) => log.requestId === options.requestId);
      }

      // Sort by timestamp descending
      result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      // Apply limit
      if (options?.limit && options.limit > 0) {
        result = result.slice(0, options.limit);
      }

      return result;
    },

    async add(entry) {
      const full: LogEntry = {
        ...entry,
        timestamp: new Date().toISOString(),
      };
      logs.push(full);
      return full;
    },

    async addBatch(entries) {
      const timestamp = new Date().toISOString();
      const fullEntries = entries.map((entry) => ({
        ...entry,
        timestamp,
      }));
      logs.push(...fullEntries);
      return fullEntries;
    },

    async deleteAll() {
      logs.length = 0;
    },

    async getForRequest(requestId) {
      return logs.filter(
        (log) =>
          log.requestId === requestId || log.parentRequestId === requestId
      );
    },
  };
}

// ============================================================================
// Testing Profile Repository
// ============================================================================

/**
 * In-memory testing profile repository.
 */
export function createMemoryTestingProfileRepository(): TestingProfileRepository {
  const profiles = new Map<string, TestingProfile>();

  return {
    async list() {
      return Array.from(profiles.values());
    },

    async get(id) {
      return profiles.get(id);
    },

    async create(profile) {
      const full: TestingProfile = {
        ...profile,
        id: generateId('profile'),
      };
      profiles.set(full.id, full);
      return full;
    },

    async update(id, updates) {
      const existing = profiles.get(id);
      if (!existing) {
        throw new Error(`Testing profile not found: ${id}`);
      }
      const updated: TestingProfile = {
        ...existing,
        ...updates,
        id: existing.id,
      };
      profiles.set(id, updated);
      return updated;
    },

    async delete(id) {
      profiles.delete(id);
    },
  };
}

// ============================================================================
// Connection Service
// ============================================================================

/**
 * In-memory connection service.
 * Wraps the actual MCP client with state tracking.
 */
export function createMemoryConnectionService(): ConnectionService {
  let state: ConnectionState = {
    status: 'disconnected',
    serverUrl: null,
    serverInfo: null,
    error: null,
  };
  const listeners = new Set<() => void>();
  let clientRef: ReturnType<typeof createMcpClient> | null = null;

  function notify() {
    listeners.forEach((l) => l());
  }

  return {
    getState() {
      return { ...state };
    },

    async connect(url, options) {
      // Update state to connecting
      state = {
        status: 'connecting',
        serverUrl: url,
        serverInfo: null,
        error: null,
      };
      notify();

      try {
        // Create client and transport
        const client = createMcpClient();
        const transport = options?.token
          ? createAuthenticatedTransport(url, options.token)
          : createHttpTransport(url, options?.headers);

        // Connect
        const serverInfo = await connectClient(client, transport);
        clientRef = client;

        // Update state to connected
        state = {
          status: 'connected',
          serverUrl: url,
          serverInfo,
          error: null,
        };
        notify();

        return serverInfo;
      } catch (err) {
        // Update state to error
        state = {
          status: 'error',
          serverUrl: url,
          serverInfo: null,
          error: {
            message: err instanceof Error ? err.message : 'Connection failed',
            timestamp: new Date().toISOString(),
          },
        };
        notify();
        throw err;
      }
    },

    async disconnect() {
      if (clientRef) {
        try {
          await disconnectClient(clientRef);
        } catch {
          // Ignore disconnect errors
        }
        clientRef = null;
      }

      state = {
        status: 'disconnected',
        serverUrl: null,
        serverInfo: null,
        error: null,
      };
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// ============================================================================
// Execution Service
// ============================================================================

/**
 * In-memory execution service.
 */
export function createMemoryExecutionService(): ExecutionService {
  let state: ExecutionState = {
    currentRequestId: null,
    isExecuting: false,
    pendingClientRequests: [],
  };
  const listeners = new Set<() => void>();

  function notify() {
    listeners.forEach((l) => l());
  }

  return {
    getState() {
      return { ...state, pendingClientRequests: [...state.pendingClientRequests] };
    },

    startExecution(requestId) {
      state = {
        ...state,
        currentRequestId: requestId,
        isExecuting: true,
      };
      notify();
    },

    endExecution() {
      state = {
        ...state,
        currentRequestId: null,
        isExecuting: false,
      };
      notify();
    },

    cancelExecution() {
      state = {
        currentRequestId: null,
        isExecuting: false,
        pendingClientRequests: [],
      };
      notify();
    },

    addPendingRequest(request) {
      state = {
        ...state,
        pendingClientRequests: [...state.pendingClientRequests, request],
      };
      notify();
    },

    resolvePendingRequest(id) {
      state = {
        ...state,
        pendingClientRequests: state.pendingClientRequests.map((r) =>
          r.id === id ? { ...r, status: 'resolved' as const } : r
        ),
      };
      notify();
    },

    rejectPendingRequest(id) {
      state = {
        ...state,
        pendingClientRequests: state.pendingClientRequests.map((r) =>
          r.id === id ? { ...r, status: 'rejected' as const } : r
        ),
      };
      notify();
    },

    clearPendingRequests() {
      state = {
        ...state,
        pendingClientRequests: [],
      };
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
