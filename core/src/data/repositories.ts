/**
 * Repository Interfaces for Inspector Data Layer
 *
 * These interfaces define CRUD contracts for data storage.
 * Implementations can use proxy API, file storage, localStorage, etc.
 * Memory stubs provided for development and testing.
 */

import type { ServerConfig } from '../types/servers.js';
import type { HistoryEntry } from '../types/history.js';
import type { LogEntry, LogLevel } from '../types/logs.js';
import type { TestingProfile } from '../types/testingProfiles.js';

/**
 * Server configuration repository.
 *
 * Manages persisted server configurations.
 * Implementations: proxy API, file-based, localStorage, memory stub
 */
export interface ServerConfigRepository {
  /**
   * List all server configurations.
   */
  list(): Promise<ServerConfig[]>;

  /**
   * Get a server configuration by ID.
   */
  get(id: string): Promise<ServerConfig | undefined>;

  /**
   * Create a new server configuration.
   * Returns the created config with generated ID and timestamps.
   */
  create(
    config: Omit<ServerConfig, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ServerConfig>;

  /**
   * Update an existing server configuration.
   * Returns the updated config with new updatedAt timestamp.
   */
  update(
    id: string,
    updates: Partial<Omit<ServerConfig, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<ServerConfig>;

  /**
   * Delete a server configuration.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all server configurations.
   */
  deleteAll(): Promise<void>;
}

/**
 * History repository.
 *
 * Manages request/response history entries with hierarchical relationships.
 * Implementations: proxy API (NDJSON), file-based, localStorage, memory stub
 */
export interface HistoryRepository {
  /**
   * List history entries with optional filtering.
   */
  list(options?: HistoryListOptions): Promise<HistoryEntry[]>;

  /**
   * Get a history entry by ID.
   */
  get(id: string): Promise<HistoryEntry | undefined>;

  /**
   * Add a new history entry.
   * Returns the entry with generated ID and timestamp.
   */
  add(entry: Omit<HistoryEntry, 'id' | 'timestamp' | 'pinned'>): Promise<HistoryEntry>;

  /**
   * Update an existing history entry.
   */
  update(
    id: string,
    updates: Partial<Omit<HistoryEntry, 'id' | 'timestamp'>>
  ): Promise<HistoryEntry>;

  /**
   * Delete a history entry.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all history entries.
   * @param options.keepPinned If true, keep pinned entries
   */
  deleteAll(options?: { keepPinned?: boolean }): Promise<void>;

  /**
   * Get children of a parent request (for hierarchical display).
   */
  getChildren(parentRequestId: string): Promise<HistoryEntry[]>;
}

export interface HistoryListOptions {
  /** Maximum number of entries to return */
  limit?: number;
  /** Filter by MCP method (e.g., 'tools/call') */
  method?: string;
  /** Filter by request type */
  requestType?: 'primary' | 'client';
  /** Only return root entries (no parentRequestId) */
  rootOnly?: boolean;
}

/**
 * Logs repository.
 *
 * Manages protocol event logs with RFC 5424 levels.
 * Implementations: proxy API, file-based, localStorage, memory stub
 */
export interface LogsRepository {
  /**
   * List log entries with optional filtering.
   */
  list(options?: LogsListOptions): Promise<LogEntry[]>;

  /**
   * Add a single log entry.
   */
  add(entry: Omit<LogEntry, 'timestamp'>): Promise<LogEntry>;

  /**
   * Add multiple log entries in batch.
   */
  addBatch(entries: Array<Omit<LogEntry, 'timestamp'>>): Promise<LogEntry[]>;

  /**
   * Delete all log entries.
   */
  deleteAll(): Promise<void>;

  /**
   * Get logs for a specific request chain (parent + children).
   */
  getForRequest(requestId: string): Promise<LogEntry[]>;
}

export interface LogsListOptions {
  /** Maximum number of entries to return */
  limit?: number;
  /** Minimum log level (includes this level and more severe) */
  minLevel?: LogLevel;
  /** Filter by logger category */
  logger?: string;
  /** Filter by request ID */
  requestId?: string;
}

/**
 * Testing profiles repository.
 *
 * Manages testing profiles for sampling/elicitation response strategies.
 * Implementations: proxy API, file-based, localStorage, memory stub
 */
export interface TestingProfileRepository {
  /**
   * List all testing profiles.
   */
  list(): Promise<TestingProfile[]>;

  /**
   * Get a testing profile by ID.
   */
  get(id: string): Promise<TestingProfile | undefined>;

  /**
   * Create a new testing profile.
   * Returns the created profile with generated ID.
   */
  create(profile: Omit<TestingProfile, 'id'>): Promise<TestingProfile>;

  /**
   * Update an existing testing profile.
   */
  update(
    id: string,
    updates: Partial<Omit<TestingProfile, 'id'>>
  ): Promise<TestingProfile>;

  /**
   * Delete a testing profile.
   */
  delete(id: string): Promise<void>;
}
