/**
 * File-based storage adapter for Zustand persist middleware.
 * Stores entire store state as JSON in a single file using atomic I/O.
 */

import { createJSONStorage } from "zustand/middleware";
import { readStoreFile, writeStoreFile, deleteStoreFile } from "../store-io.js";

export interface FileStorageAdapterOptions {
  /** Full path to the storage file */
  filePath: string;
}

/**
 * Creates a Zustand storage adapter that reads/writes from a file.
 * Conforms to Zustand's StateStorage interface.
 */
export function createFileStorageAdapter(
  options: FileStorageAdapterOptions,
): ReturnType<typeof createJSONStorage> {
  return createJSONStorage(() => ({
    getItem: async () => readStoreFile(options.filePath),
    setItem: async (_name: string, value: string) =>
      writeStoreFile(options.filePath, value),
    removeItem: async () => deleteStoreFile(options.filePath),
  }));
}
