/**
 * Node-only file backend for OAuth persistence. Kept out of the isomorphic
 * `core/auth/oauth-persist.ts` because it imports `store-io.js` (which pulls
 * `node:fs`/`atomically`); the browser must never load that. Node consumers
 * (e.g. `NodeOAuthStorage`) import the file backend from here, while the
 * shared blob (de)serialization and browser/remote backends stay isomorphic.
 *
 * Sectioned writes (`OAuthPersistSections`) are applied here as a locked
 * read-modify-write: only the named entries are overlaid onto a fresh read of
 * the file, so several processes (web backend, daemon, CLI) sharing one
 * `oauth.json` can each persist their own mutations without erasing entries
 * the others wrote after this process last read the file.
 */

import {
  readStoreFile,
  writeStoreFile,
  deleteStoreFile,
} from "../../storage/store-io.js";
import {
  mergeOAuthSections,
  parseOAuthPersistBlob,
  serializeOAuthPersistBlob,
  type OAuthPersistBackend,
  type OAuthPersistSections,
  type OAuthPersistSnapshot,
} from "../oauth-persist.js";
import { withSecretFileLock } from "./file-lock.js";
import { SecretStoreUnavailableError } from "./secret-store.js";

export interface FileOAuthPersistBackendOptions {
  filePath: string;
}

/**
 * Overlay the named sections of `snapshot` onto the OAuth state file under
 * the cross-process file lock: lock → fresh read → merge → atomic write.
 * Shared by the file backend and the remote server's storage route so both
 * writers use the identical locked merge.
 *
 * The lock's own errors talk about "the secrets file" (its other caller);
 * they are rethrown with OAuth wording so an operator seeing the message
 * looks at `oauth.json`, with the original attached as `cause`.
 */
export async function writeOAuthSections(
  filePath: string,
  snapshot: OAuthPersistSnapshot,
  sections: OAuthPersistSections,
): Promise<void> {
  try {
    await withSecretFileLock(filePath, async () => {
      const disk = parseOAuthPersistBlob(await readStoreFile(filePath));
      const merged = mergeOAuthSections(disk, snapshot, sections);
      await writeStoreFile(filePath, serializeOAuthPersistBlob(merged));
    });
  } catch (error) {
    if (error instanceof SecretStoreUnavailableError) {
      throw new Error(
        `Could not save OAuth state: the state file at ${filePath} is locked by another Inspector process and did not become available.`,
        { cause: error },
      );
    }
    throw error;
  }
}

export function createFileOAuthPersistBackend(
  options: FileOAuthPersistBackendOptions,
): OAuthPersistBackend {
  return {
    async read() {
      const raw = await readStoreFile(options.filePath);
      return parseOAuthPersistBlob(raw);
    },
    async write(snapshot, sections) {
      if (sections) {
        await writeOAuthSections(options.filePath, snapshot, sections);
        return;
      }
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
