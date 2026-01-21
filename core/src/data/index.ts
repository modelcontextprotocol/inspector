/**
 * Data Layer Interfaces
 *
 * Repository interfaces define CRUD contracts for data storage.
 * Implementations (proxy API, file-based, localStorage) to be added
 * when proxy server is built.
 *
 * Note: Connection/execution state management is handled by UI-specific
 * patterns (React Context, Zustand stores) per v2_storage.md spec.
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
