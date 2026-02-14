/**
 * File-based storage adapter for Zustand persist middleware.
 * Stores entire store state as JSON in a single file.
 */
import { createJSONStorage } from "zustand/middleware";
export interface FileStorageAdapterOptions {
    /** Full path to the storage file */
    filePath: string;
}
/**
 * Creates a Zustand storage adapter that reads/writes from a file.
 * Conforms to Zustand's StateStorage interface.
 */
export declare function createFileStorageAdapter(options: FileStorageAdapterOptions): ReturnType<typeof createJSONStorage>;
//# sourceMappingURL=file-storage.d.ts.map