/**
 * Storage adapters for Zustand persist middleware.
 * Provides adapters for file, remote HTTP, and browser storage.
 */

export { createFileStorageAdapter } from "./file-storage.js";
export type { FileStorageAdapterOptions } from "./file-storage.js";

export { createRemoteStorageAdapter } from "./remote-storage.js";
export type { RemoteStorageAdapterOptions } from "./remote-storage.js";
