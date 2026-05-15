/**
 * Shared storage path resolution, validation, and atomic file I/O.
 * Used by the file storage adapter and the remote server's /api/storage routes.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { readFile, writeFile } from "atomically";

/**
 * Default storage directory (~/.mcp-inspector/storage or %USERPROFILE%\.mcp-inspector\storage on Windows).
 */
export function getDefaultStorageDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
  return path.join(homeDir, ".mcp-inspector", "storage");
}

/**
 * Path for a store ID under the given storage directory.
 * Callers must pass a validated storeId.
 */
export function getStoreFilePath(storageDir: string, storeId: string): string {
  return path.join(storageDir, `${storeId}.json`);
}

/**
 * Validate storeId to prevent path traversal.
 * Store IDs must be alphanumeric, hyphens, underscores only, and not empty.
 */
export function validateStoreId(storeId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(storeId) && storeId.length > 0;
}

/**
 * Read store file atomically. Returns null if the file does not exist (ENOENT).
 * @throws on other read errors or parse errors (caller may use parseStore on the string).
 */
export async function readStoreFile(filePath: string): Promise<string | null> {
  try {
    const data = await readFile(filePath, { encoding: "utf-8" });
    return data;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Write store file atomically (temp file + rename). Ensures parent directory exists.
 * Uses mode 0o600 for the file.
 */
export async function writeStoreFile(
  filePath: string,
  data: string,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await writeFile(filePath, data, {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * Delete store file. Ignores ENOENT (already deleted).
 */
export async function deleteStoreFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw error;
    }
  }
}

/**
 * Serialize store data to JSON string (consistent format for server writes).
 */
export function serializeStore(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Parse store JSON string. Use after readStoreFile when returning parsed object.
 */
export function parseStore(raw: string): unknown {
  return JSON.parse(raw);
}
