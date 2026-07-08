/**
 * Node-only file backend for OAuth persistence. Kept out of the isomorphic
 * `core/auth/oauth-persist.ts` because it imports `store-io.js` (which pulls
 * `node:fs`/`atomically`); the browser must never load that. Node consumers
 * (e.g. `NodeOAuthStorage`) import the file backend from here, while the
 * shared blob (de)serialization and browser/remote backends stay isomorphic.
 */

import {
  readStoreFile,
  writeStoreFile,
  deleteStoreFile,
} from "../../storage/store-io.js";
import {
  parseOAuthPersistBlob,
  serializeOAuthPersistBlob,
  type OAuthPersistBackend,
} from "../oauth-persist.js";

export interface FileOAuthPersistBackendOptions {
  filePath: string;
}

export function createFileOAuthPersistBackend(
  options: FileOAuthPersistBackendOptions,
): OAuthPersistBackend {
  return {
    async read() {
      const raw = await readStoreFile(options.filePath);
      return parseOAuthPersistBlob(raw);
    },
    async write(snapshot) {
      await writeStoreFile(
        options.filePath,
        serializeOAuthPersistBlob(snapshot),
      );
    },
    async remove() {
      await deleteStoreFile(options.filePath);
    },
  };
}
