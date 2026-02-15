/**
 * File-based storage adapter for Zustand persist middleware.
 * Stores entire store state as JSON in a single file.
 */

import { createJSONStorage } from "zustand/middleware";
import * as fs from "node:fs/promises";
import * as path from "node:path";

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
    getItem: async (name: string) => {
      try {
        const data = await fs.readFile(options.filePath, "utf-8");
        return data;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    setItem: async (name: string, value: string) => {
      // Ensure directory exists
      const dir = path.dirname(options.filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(options.filePath, value, "utf-8");
      // Set restrictive permissions (600) for security
      try {
        await fs.chmod(options.filePath, 0o600);
      } catch {
        // Ignore chmod errors (may fail on some systems)
      }
    },
    removeItem: async (name: string) => {
      try {
        await fs.unlink(options.filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    },
  }));
}
