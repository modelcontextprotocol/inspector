/**
 * Data Layer Interfaces and Memory Stubs
 *
 * This module provides:
 * - Repository interfaces for data storage (CRUD contracts)
 * - Service interfaces for stateful business logic
 * - Memory stub implementations for development/testing
 *
 * Real implementations (proxy API, file-based, localStorage) can be added later.
 */

// Repository interfaces
export type {
  ServerConfigRepository,
  HistoryRepository,
  HistoryListOptions,
  LogsRepository,
  LogsListOptions,
  TestingProfileRepository,
} from './repositories.js';

// Service interfaces
export type {
  ConnectionService,
  ConnectionState,
  ConnectionError,
  ConnectionOptions,
  ExecutionService,
  ExecutionState,
  PendingClientRequest,
} from './services.js';

// Initial state exports
export { initialConnectionState, initialExecutionState } from './services.js';

// Memory stub implementations
export {
  createMemoryServerConfigRepository,
  createMemoryHistoryRepository,
  createMemoryLogsRepository,
  createMemoryTestingProfileRepository,
  createMemoryConnectionService,
  createMemoryExecutionService,
} from './memory.js';
