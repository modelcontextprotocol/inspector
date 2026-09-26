/**
 * Node-only client.json persistence with OS keychain for IdP clientSecret.
 */

import { withSecretFileLock } from "../auth/node/file-lock.js";
import {
  restoreSecretFields,
  SecretFileLockHeldError,
  secretStoreGetStrict,
  secretStoreIsDurable,
  SecretStoreUnavailableError,
  snapshotSecretFields,
  type SecretStore,
} from "../auth/node/secret-store.js";
import { SECRET_FIELD_IDP_CLIENT_SECRET } from "../auth/secret-fields.js";
import {
  deleteStoreFile,
  parseStore,
  readStoreFile,
  serializeStore,
  writeStoreFile,
} from "../storage/store-io.js";
import { parseClientConfig } from "./config-parse.js";
import type { ClientConfig } from "./types.js";
import {
  CLIENT_KEYCHAIN_ID,
  extractSecretsFromClientConfig,
  hasClientPlaintextSecret,
  mergeSecretsIntoClientConfig,
} from "./secrets.js";

/**
 * Run `body` under client.json's file lock — the same per-resolved-path
 * exclusion (`withSecretFileLock`) oauth.json's writers take.
 *
 * Every combined file/store sequence here — snapshot, store mutation, file
 * write, and the compensating restore — must hold it for its whole duration:
 * two unserialized writers both snapshot the same prior value, and the
 * loser's compensation then overwrites the winner's *committed* secret with
 * the stale snapshot, leaving client.json describing one client while the
 * keychain holds another's secret. Where the lock cannot be created at all,
 * `withSecretFileLock` runs the body unprotected with a warning — the same
 * documented degradation as every other locked writer (#1848, #1905).
 *
 * Only lock *acquisition* failures are reworded to name client.json (the
 * library's message says "secrets file", which would send the user to the
 * wrong path). The same error type escaping mid-body comes from the nested
 * secret store contending on its own lock, which the rewording must not
 * mask — see `withOAuthStateLock`, the identical seam on the OAuth side.
 */
async function withClientConfigLock<T>(
  filePath: string,
  action: "save" | "remove" | "migrate",
  body: () => Promise<T>,
): Promise<T> {
  let entered = false;
  try {
    return await withSecretFileLock(filePath, async () => {
      entered = true;
      return body();
    });
  } catch (error) {
    if (!entered && error instanceof SecretFileLockHeldError) {
      throw new SecretFileLockHeldError(
        `Could not ${action} the client configuration: the file at ${filePath} is locked by another Inspector process and did not become available.`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function readIdpSecretFromKeychain(
  secretStore: SecretStore,
): Promise<Record<string, string>> {
  const secret = await secretStore.get(
    CLIENT_KEYCHAIN_ID,
    SECRET_FIELD_IDP_CLIENT_SECRET,
  );
  if (!secret) return {};
  return { [SECRET_FIELD_IDP_CLIENT_SECRET]: secret };
}

async function migrateClientPlaintextSecret(
  filePath: string,
  config: ClientConfig,
  secretStore: SecretStore,
): Promise<ClientConfig> {
  try {
    return await withClientConfigLock(filePath, "migrate", async () => {
      // Re-read under the lock: the caller's unlocked read may predate a
      // concurrent writer, and stripping from that stale copy would write
      // the pre-write config back over the newer file below. The fresh copy
      // also decides whether there is still anything to migrate.
      const raw = await readStoreFile(filePath);
      if (raw === null) return {};
      const fresh = parseClientConfig(parseStore(raw));
      const { stripped, secrets } = extractSecretsFromClientConfig(fresh);
      const value = secrets[SECRET_FIELD_IDP_CLIENT_SECRET];
      if (!value) return fresh;

      try {
        // Strict: `get` answers `null` for an unreadable store as well as a
        // missing entry, and the branch below *writes* on `null` — so a
        // transient failure would overwrite a newer stored secret with the
        // older `client.json` copy, inverting keychain-wins. A throw is
        // caught below and leaves the plaintext file untouched for the next
        // attempt.
        const existing = await secretStoreGetStrict(
          secretStore,
          CLIENT_KEYCHAIN_ID,
          SECRET_FIELD_IDP_CLIENT_SECRET,
        );
        if (existing === null) {
          await secretStore.set(
            CLIENT_KEYCHAIN_ID,
            SECRET_FIELD_IDP_CLIENT_SECRET,
            value,
          );
        }
        // Only strip the plaintext once it is somewhere that outlives us.
        // Against a session-scoped store (the container fallback added in
        // #1950) this migration would trade a secret that survives restarts
        // for one that dies with the process — and it runs on an ordinary
        // read, so merely loading the app would destroy it. The value is
        // still loaded into the store above, so this session behaves
        // normally; only the delete is withheld.
        if (!(await secretStoreIsDurable(secretStore))) return fresh;
        await writeStoreFile(filePath, serializeStore(stripped));
        return stripped;
      } catch (err) {
        if (err instanceof SecretStoreUnavailableError) {
          return fresh;
        }
        throw err;
      }
    });
  } catch (err) {
    // A held lock fails the *migration*, not the read: serve the config the
    // unlocked read produced and leave the plaintext for the next attempt.
    if (err instanceof SecretFileLockHeldError) return config;
    throw err;
  }
}

/** Read client.json from disk and rehydrate IdP clientSecret from the keychain. */
export async function readClientConfigStore(
  filePath: string,
  secretStore: SecretStore,
): Promise<ClientConfig> {
  const raw = await readStoreFile(filePath);
  if (raw === null) {
    return {};
  }

  let config = parseClientConfig(parseStore(raw));
  if (hasClientPlaintextSecret(config)) {
    config = await migrateClientPlaintextSecret(filePath, config, secretStore);
  }

  const secrets = await readIdpSecretFromKeychain(secretStore);
  return mergeSecretsIntoClientConfig(config, secrets);
}

/** Validate, strip IdP clientSecret to keychain, and write client.json. */
export async function writeClientConfigStore(
  filePath: string,
  body: unknown,
  secretStore: SecretStore,
): Promise<void> {
  const validated = parseClientConfig(body);
  const { stripped, secrets } = extractSecretsFromClientConfig(validated);
  const idpSecret = secrets[SECRET_FIELD_IDP_CLIENT_SECRET];
  await withClientConfigLock(filePath, "save", async () => {
    // Snapshot before mutating so a failed file write below can restore the
    // keychain: committing the new secret while the old config survives on
    // disk (or dropping a cleared one the disk still expects) would leave the
    // two halves describing different clients. The strict read also aborts
    // here — before anything is mutated — when the store is unreadable. The
    // snapshot is only trustworthy under the lock above: taken concurrently,
    // two writers would each snapshot the other's uncommitted state.
    const prior = await snapshotSecretFields(secretStore, CLIENT_KEYCHAIN_ID, [
      SECRET_FIELD_IDP_CLIENT_SECRET,
    ]);
    try {
      if (idpSecret) {
        await secretStore.set(
          CLIENT_KEYCHAIN_ID,
          SECRET_FIELD_IDP_CLIENT_SECRET,
          idpSecret,
        );
      } else {
        await secretStore.delete(
          CLIENT_KEYCHAIN_ID,
          SECRET_FIELD_IDP_CLIENT_SECRET,
        );
      }
      // What actually goes to disk. The read-path migration already withholds
      // the strip for a session-scoped store, but the *write* path did not — so
      // saving any unrelated field (a CIMD URL, an issuer) round-tripped the
      // rehydrated secret through the form and then wrote the stripped shape,
      // moving the only durable copy into RAM to be lost at exit. The two paths
      // have to agree: while the store cannot outlive the process, `client.json`
      // stays the durable copy.
      const durable = await secretStoreIsDurable(secretStore);
      await writeStoreFile(
        filePath,
        serializeStore(
          durable
            ? stripped
            : await preserveLegacyPlaintext(
                filePath,
                validated,
                stripped,
                idpSecret,
              ),
        ),
      );
    } catch (error) {
      await restoreSecretFields(secretStore, prior, (restoreError) => {
        console.warn(
          `[mcp-inspector] Could not restore the IdP client secret after a failed client.json write: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
        );
      });
      throw error;
    }
  });
}

/**
 * For a session-scoped store: keep the IdP secret on disk only when it was
 * **already there, unchanged**.
 *
 * Stripping legacy plaintext would move the only durable copy into RAM (the
 * read-path migration withholds its strip for exactly this reason, and the
 * write path has to agree). But writing a *newly entered* secret to disk
 * would contradict the footer, which promises a session store writes secrets
 * nowhere — so provenance decides, not the presence of a value in the
 * submitted body.
 */
async function preserveLegacyPlaintext(
  filePath: string,
  validated: ClientConfig,
  stripped: ClientConfig,
  idpSecret: string | undefined,
): Promise<ClientConfig> {
  if (!idpSecret) return stripped;
  try {
    const raw = await readStoreFile(filePath);
    if (raw === null) return stripped;
    const prior = parseClientConfig(parseStore(raw));
    const priorSecret =
      extractSecretsFromClientConfig(prior).secrets[
        SECRET_FIELD_IDP_CLIENT_SECRET
      ];
    return priorSecret === idpSecret ? validated : stripped;
  } catch {
    // Unreadable or unparseable prior file: treat the value as new, which is
    // the conservative direction — it keeps the secret off disk rather than
    // writing it there on a guess.
    return stripped;
  }
}

/** Remove client.json and the install-level IdP secret from the keychain. */
export async function deleteClientConfigStore(
  filePath: string,
  secretStore: SecretStore,
): Promise<void> {
  // All-or-nothing, like every other combined file/store writer: snapshot
  // the secret, then run the delete *and* the unlink inside one
  // compensated block — all of it under the file's lock, so the snapshot
  // cannot capture another writer's uncommitted state. The keychain delete
  // precedes the unlink but is
  // itself only confirmed-on-resolve — a rejected delete may have removed
  // the value before failing — so its failure must restore the snapshot
  // exactly like an unlink failure, leaving the surviving config with its
  // credential intact and the retry seeing the same pre-delete state.
  await withClientConfigLock(filePath, "remove", async () => {
    const prior = await snapshotSecretFields(secretStore, CLIENT_KEYCHAIN_ID, [
      SECRET_FIELD_IDP_CLIENT_SECRET,
    ]);
    try {
      await secretStore.delete(
        CLIENT_KEYCHAIN_ID,
        SECRET_FIELD_IDP_CLIENT_SECRET,
      );
      await deleteStoreFile(filePath);
    } catch (error) {
      await restoreSecretFields(secretStore, prior, (restoreError) => {
        console.warn(
          `[mcp-inspector] Could not restore the IdP client secret after a failed client.json delete: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
        );
      });
      throw error;
    }
  });
}
