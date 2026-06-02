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
 * Default path for the user's server list file
 * (~/.mcp-inspector/mcp.json or %USERPROFILE%\.mcp-inspector\mcp.json on Windows).
 */
export function getDefaultMcpConfigPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
  return path.join(homeDir, ".mcp-inspector", "mcp.json");
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
 * In-flight writeStoreFile() promises, keyed by resolved path. Lets callers
 * await persistence completion via flushStoreFileWrites() instead of polling
 * the file — Zustand's persist middleware invokes writeStoreFile() fire-and-
 * forget, so the in-memory store updates synchronously while the file write
 * lags. Entries are removed once their write settles.
 *
 * Load-bearing: pendingWrites.set() below runs synchronously before the first
 * await in writeStoreFile(), so a flushStoreFileWrites() called right after a
 * persist sees the in-flight entry. Callers (e.g. the storage adapter's
 * setItem) must not introduce an await before writeStoreFile() — doing so would
 * let a flush run before registration and return early.
 */
const pendingWrites = new Map<string, Promise<void>>();

/**
 * Write store file atomically (temp file + rename). Ensures parent directory exists.
 * Uses mode 0o600 for the file.
 *
 * The returned promise is also tracked per path so flushStoreFileWrites() can
 * await it. Writes to the same path are chained so a flush awaits every queued
 * write (and a later write's completion implies all earlier ones settled).
 */
export async function writeStoreFile(
  filePath: string,
  data: string,
): Promise<void> {
  const key = path.resolve(filePath);
  const run = async (): Promise<void> => {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await writeFile(filePath, data, {
      encoding: "utf-8",
      mode: 0o600,
    });
  };
  const prior = pendingWrites.get(key);
  const tracked = (prior ?? Promise.resolve()).catch(() => {}).then(run);
  pendingWrites.set(key, tracked);
  try {
    await tracked;
  } finally {
    if (pendingWrites.get(key) === tracked) {
      pendingWrites.delete(key);
    }
  }
}

/**
 * Await pending writeStoreFile() writes — those for `filePath` if given, else
 * all of them. Use in tests after triggering persistence (Zustand persist
 * writes fire-and-forget) instead of polling the file, and for graceful
 * shutdown. Resolves immediately when nothing is in flight.
 */
export async function flushStoreFileWrites(filePath?: string): Promise<void> {
  if (filePath !== undefined) {
    await pendingWrites.get(path.resolve(filePath));
    return;
  }
  await Promise.all(pendingWrites.values());
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
