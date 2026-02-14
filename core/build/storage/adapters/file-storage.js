/**
 * File-based storage adapter for Zustand persist middleware.
 * Stores entire store state as JSON in a single file.
 */
import { createJSONStorage } from "zustand/middleware";
import * as fs from "node:fs/promises";
import * as path from "node:path";
/**
 * Creates a Zustand storage adapter that reads/writes from a file.
 * Conforms to Zustand's StateStorage interface.
 */
export function createFileStorageAdapter(options) {
    return createJSONStorage(() => ({
        getItem: async (name) => {
            try {
                const data = await fs.readFile(options.filePath, "utf-8");
                return data;
            }
            catch (error) {
                if (error.code === "ENOENT") {
                    return null;
                }
                throw error;
            }
        },
        setItem: async (name, value) => {
            // Ensure directory exists
            const dir = path.dirname(options.filePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(options.filePath, value, "utf-8");
            // Set restrictive permissions (600) for security
            try {
                await fs.chmod(options.filePath, 0o600);
            }
            catch {
                // Ignore chmod errors (may fail on some systems)
            }
        },
        removeItem: async (name) => {
            try {
                await fs.unlink(options.filePath);
            }
            catch (error) {
                if (error.code !== "ENOENT") {
                    throw error;
                }
            }
        },
    }));
}
//# sourceMappingURL=file-storage.js.map