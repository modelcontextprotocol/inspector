/**
 * Node-only file backend for OAuth persistence. Kept out of the isomorphic
 * `core/auth/oauth-persist.ts` because it imports `store-io.js` (which pulls
 * `node:fs`/`atomically`); the browser must never load that. Node consumers
 * (e.g. `NodeOAuthStorage`) import the file backend from here, while the
 * shared blob (de)serialization and browser/remote backends stay isomorphic.
 *
 * Two properties are enforced at this boundary:
 *
 * 1. **Sectioned writes** (`OAuthPersistSections`): a locked read-modify-write
 *    overlays only the entries the calling mutation touched onto a fresh read
 *    of the file, so several processes (web backend, daemon, CLI) sharing one
 *    `oauth.json` can each persist their own mutations without erasing
 *    entries the others wrote after this process last read the file.
 * 2. **Secret split** (`oauth-secrets.ts`): acquired tokens, client secrets,
 *    and IdP session tokens go to the {@link SecretStore}; only the
 *    non-secret residue is written to `oauth.json`. Reads rejoin the two and
 *    lazily migrate a pre-split plaintext file — stripping it only when the
 *    store is durable, the same guard the mcp.json/client.json migrations
 *    use. A store write failure degrades those tokens to memory-only with a
 *    loud warning; it never falls back to writing them into the file.
 */

import {
  readStoreFile,
  writeStoreFile,
  deleteStoreFile,
} from "../../storage/store-io.js";
import { setOwnEntry, getOwnEntry } from "../../storage/own-entry.js";
import {
  mergeOAuthSections,
  parseOAuthPersistBlob,
  serializeOAuthPersistBlob,
  type OAuthPersistBackend,
  type OAuthPersistSections,
  type OAuthPersistSnapshot,
} from "../oauth-persist.js";
import { withSecretFileLock } from "./file-lock.js";
import {
  restoreSecretFields,
  SecretFileLockHeldError,
  secretStoreGetManyStrict,
  secretStoreGetStrict,
  secretStoreIsDurable,
  secretStoreSetMany,
  settleStoreMutations,
  snapshotSecretFields,
  type SecretBulkRequest,
  type SecretFieldSnapshot,
  type SecretStore,
} from "./secret-store.js";
import { defaultSecretStore } from "./secret-store-selection.js";
import {
  IDP_SESSION_FIELD,
  getPersistTokensPolicy,
  isUsableStoredSecret,
  joinIdpSession,
  joinServerOAuthState,
  oauthIdpSecretServerId,
  oauthSecretServerId,
  serverSecretFields,
  snapshotHasPlaintextSecrets,
  splitIdpSession,
  splitServerOAuthState,
  type OAuthSecretValues,
} from "./oauth-secrets.js";

export interface FileOAuthPersistBackendOptions {
  filePath: string;
  /** Injection seam for tests and the remote server route. */
  secretStore?: SecretStore;
}

const warnedStoreFailures = new Set<string>();

/**
 * A failed secret-store write means those tokens survive only in this
 * process's memory — said loudly, once per reason, because the user's next
 * restart will silently want a re-auth. Deliberately NOT a fallback to
 * writing the secrets into `oauth.json`: that would quietly undo the reason
 * the store exists.
 */
function warnStoreWriteFailure(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  if (warnedStoreFailures.has(reason)) return;
  warnedStoreFailures.add(reason);
  console.warn(
    `[mcp-inspector] Could not write OAuth tokens to the secret store (${reason}). Tokens will be kept in memory for this session only and will NOT be persisted; expect to re-authorize after a restart.`,
  );
}

/** Test seam: forget which store-failure warnings have been emitted. */
export function resetOAuthSecretStoreWarnings(): void {
  warnedStoreFailures.clear();
}

/**
 * Migration-failure variant of {@link warnStoreWriteFailure}: here the
 * plaintext file is deliberately left untouched, so the write-path message
 * ("memory only, expect to re-authorize") would be wrong — nothing was
 * lost, and the next read retries the migration.
 */
function warnMigrationFailure(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  const key = `migration:${reason}`;
  if (warnedStoreFailures.has(key)) return;
  warnedStoreFailures.add(key);
  console.warn(
    `[mcp-inspector] Could not migrate plaintext OAuth secrets into the secret store (${reason}). The plaintext copy in oauth.json was kept and keeps working; migration will be retried on the next read.`,
  );
}

/**
 * Rethrow the lock's "secrets file" wording as OAuth wording (same file),
 * preserving the {@link SecretFileLockHeldError} type — it extends
 * `SecretStoreUnavailableError`, which the HTTP layer maps to a retryable
 * 503; rewrapping in a plain `Error` would demote lock contention to a
 * generic 500. Called only for lock *acquisition* failures (see
 * {@link withOAuthStateLock}): a failure thrown inside the locked callback
 * — a `KeychainUnavailableError`, or a `SecretFileLockHeldError` from the
 * nested `FileSecretStore` locking `secrets.json` — is not *this* file's
 * lock and passes through unchanged, so the error keeps naming the file
 * that is actually contended.
 */
function rethrowLockError(
  filePath: string,
  error: unknown,
  action: "save" | "read" | "remove" = "save",
): never {
  if (error instanceof SecretFileLockHeldError) {
    throw new SecretFileLockHeldError(
      `Could not ${action} OAuth state: the state file at ${filePath} is locked by another Inspector process and did not become available.`,
      { cause: error },
    );
  }
  throw error;
}

/**
 * Run `body` under the OAuth state file's lock, rewording only lock
 * *acquisition* failures via {@link rethrowLockError}. The `entered` flag
 * is what distinguishes them: `withSecretFileLock` throws
 * `SecretFileLockHeldError` before the callback runs when the lock is
 * held, while the same error type escaping mid-callback comes from the
 * nested secret store contending on `secrets.json` — rewording that one
 * would direct the user at the wrong file.
 */
async function withOAuthStateLock<T>(
  filePath: string,
  action: "save" | "read" | "remove",
  body: () => Promise<T>,
): Promise<T> {
  let entered = false;
  try {
    return await withSecretFileLock(filePath, async () => {
      entered = true;
      return body();
    });
  } catch (error) {
    if (!entered) rethrowLockError(filePath, error, action);
    throw error;
  }
}

/**
 * The OAuth state file exists but is not a recognized OAuth state shape
 * (valid JSON of the wrong structure, or an empty/truncated file — malformed
 * JSON already throws out of `JSON.parse`). Mutations refuse to proceed:
 * the file's keys are the only index of the secret-store entries, so
 * treating an unrecognized file as empty would let a sectioned write
 * replace it with just the named entries — or let removal skip the purge —
 * orphaning every other entry's credentials in the store. Reads stay
 * tolerant (an unrecognized file presents as "no stored state"), which is
 * safe precisely because every mutation re-reads under the lock and lands
 * here before anything is deleted or overwritten.
 */
export class OAuthStateFileUnrecognizedError extends Error {
  constructor(filePath: string, action: "save" | "remove") {
    super(
      `Refusing to ${action} OAuth state: ${filePath} exists but is not a recognized OAuth state file (it may be corrupt, truncated, or written by something else). ` +
        `Its entries are the only index of credentials in the OS keychain / secret store, so overwriting it would strand them. ` +
        `Restore the file from a backup or fix its JSON; deleting it starts fresh but abandons any credentials it indexed.`,
    );
    this.name = "OAuthStateFileUnrecognizedError";
  }
}

/**
 * Locked-read helper for the mutation paths: parse the OAuth state file,
 * distinguishing "absent" (null) from "present but unrecognized" (refuse —
 * see {@link OAuthStateFileUnrecognizedError}).
 */
async function readDiskForMutation(
  filePath: string,
  action: "save" | "remove",
): Promise<OAuthPersistSnapshot | null> {
  const raw = await readStoreFile(filePath);
  const parsed = parseOAuthPersistBlob(raw);
  if (raw !== null && parsed === null) {
    throw new OAuthStateFileUnrecognizedError(filePath, action);
  }
  return parsed;
}

/**
 * Persist one entry's secrets: set every post-split value, delete every
 * candidate field the split no longer produces (clears and policy
 * downgrades propagate as deletions). A failed *set* degrades to
 * memory-only — but only after the fields the batch touched are restored
 * to their `prior` values: the bulk set settles every sibling before
 * rejecting, so some writes may already have landed, and committing
 * residue over a store holding a mixed old/new credential set would let
 * the next read rejoin tokens that were never issued together. When that
 * compensation itself cannot be confirmed the write aborts instead — the
 * store's state is unknown, so the file must not move. A failed *delete*
 * must abort likewise: committing residue that omits a secret while the
 * store may still hold it lets the next read rejoin (resurrect) the
 * cleared value.
 */
/**
 * Persist one entry's secrets: set every post-split value, delete every
 * candidate field the split no longer produces (clears and policy
 * downgrades propagate as deletions). Returns whether the new state was
 * persisted.
 *
 * A failed *set* degrades the entry to memory-only, all-or-nothing: the
 * bulk set settles every sibling before rejecting, so some writes may
 * already have landed, and a store holding a mixed old/new credential set
 * would let the next read rejoin tokens that were never issued together.
 * The catch restores the fields the batch touched to their `prior` values
 * and returns `false` **without running the deletes** — the caller must
 * then keep the entry's *prior* residue in the file as well, because new
 * residue over restored old secrets is just the same mismatch on the other
 * side (a re-registered `client_id` paired with the old `client_secret`).
 * The prior file entry and the restored prior store fields together are the
 * consistent pre-write state; the new credentials live only in memory for
 * the session. When the compensation itself cannot be confirmed the write
 * aborts instead — the store's state is unknown, so the file must not
 * move. A failed *delete* must abort likewise: committing residue that
 * omits a secret while the store may still hold it lets the next read
 * rejoin (resurrect) the cleared value.
 */
async function persistEntrySecrets(
  store: SecretStore,
  serverId: string,
  candidates: string[],
  secrets: Record<string, string>,
  prior: SecretFieldSnapshot[],
): Promise<boolean> {
  try {
    if (Object.keys(secrets).length > 0) {
      await secretStoreSetMany(store, serverId, secrets);
    }
  } catch (error) {
    warnStoreWriteFailure(error);
    // Restore only the fields the batch could have touched: an untouched
    // field's restore cannot help, but its failure would abort needlessly.
    const touched = prior.filter(({ field }) => secrets[field] !== undefined);
    let restoreFailure: unknown;
    await restoreSecretFields(store, touched, (err) => {
      restoreFailure = err;
    });
    if (restoreFailure !== undefined) throw restoreFailure;
    return false;
  }
  // Settle every delete before surfacing the first failure: the caller's
  // rollback (restoreSecretFields) must not race deletes still in flight,
  // which could remove a value the rollback just restored.
  await settleStoreMutations(
    candidates
      .filter((field) => secrets[field] === undefined)
      .map((field) => store.delete(serverId, field)),
  );
  return true;
}

/**
 * Put one section entry back to its on-disk value after a memory-only
 * degradation (see {@link persistEntrySecrets}): the entry that could not
 * persist its secrets keeps its prior residue too, so file and store stay
 * a consistent pair. An entry the disk never had is removed from the merge
 * outright.
 */
function revertEntryToDisk<T>(
  merged: Record<string, T>,
  disk: Record<string, T> | undefined,
  key: string,
): void {
  const diskEntry = getOwnEntry(disk, key);
  if (diskEntry === undefined) {
    if (Object.hasOwn(merged, key)) delete merged[key];
  } else {
    setOwnEntry(merged, key, diskEntry);
  }
}

/**
 * The write-path counterpart of the migration's durable-store guard: when
 * the store is session-scoped, a secret that is already durable as file
 * plaintext and is being written back **unchanged** stays in the residue,
 * so an unrelated mutation (a scope save, a verifier) cannot demote the
 * only durable token copy to memory-only. New or changed secrets are still
 * kept out of the file — they live for this session only, the documented
 * memory-store contract.
 */
function preserveNonDurableSecrets(
  diskSecrets: OAuthSecretValues,
  secrets: OAuthSecretValues,
): OAuthSecretValues {
  const keep: OAuthSecretValues = {};
  for (const [field, value] of Object.entries(secrets)) {
    if (diskSecrets[field] === value) keep[field] = value;
  }
  return keep;
}

/**
 * Overlay the named sections of `snapshot` onto the OAuth state file under
 * the cross-process file lock — lock → fresh read → merge → split secrets to
 * the store → atomic write of the residue. Shared by the file backend, the
 * remote server's storage route, and the CLI's stored-token refresh, so
 * every writer uses the identical locked merge and the identical split.
 *
 * When `sections` is omitted the write is a full replacement: sections are
 * derived as the union of the file's and the snapshot's keys, which
 * overlays everything present and deletes everything absent — same code
 * path, same secret handling.
 */
export async function writeOAuthSections(
  filePath: string,
  snapshot: OAuthPersistSnapshot,
  sections?: OAuthPersistSections,
  secretStore: SecretStore = defaultSecretStore(),
): Promise<void> {
  const policy = getPersistTokensPolicy();
  const durable = await secretStoreIsDurable(secretStore);
  await withOAuthStateLock(filePath, "save", async () => {
    const disk = await readDiskForMutation(filePath, "save");
    // Deduplicated: caller-passed sections may repeat a URL/issuer, and a
    // second pass over the same entry would snapshot the value the first
    // pass just wrote — a rollback would then "restore" that intermediate
    // value over the real prior one. An omitted list stays omitted (that
    // section of the file is left untouched).
    const effective: OAuthPersistSections = sections
      ? {
          servers: sections.servers && [...new Set(sections.servers)],
          idpSessions: sections.idpSessions && [
            ...new Set(sections.idpSessions),
          ],
        }
      : {
          servers: [
            ...new Set([
              ...Object.keys(disk?.servers ?? {}),
              ...Object.keys(snapshot.servers),
            ]),
          ],
          idpSessions: [
            ...new Set([
              ...Object.keys(disk?.idpSessions ?? {}),
              ...Object.keys(snapshot.idpSessions),
            ]),
          ],
        };
    const merged = mergeOAuthSections(disk, snapshot, effective);
    // Pre-write store values for every secret field this write touches.
    // If anything fails after the store mutations begin — a delete, a
    // later entry's snapshot read, or the residue file write — the store
    // is restored to match the file that is still on disk. Without this,
    // a failed residue write leaves the store ahead of the file: a
    // brand-new entry's secrets are stranded with no file index for
    // `removeOAuthStore` to find, and an updated entry rejoins its *old*
    // residue with the *new* secrets (e.g. the previous client_id paired
    // with the re-registered client_secret) on the next read.
    const priorSecrets: SecretFieldSnapshot[] = [];

    try {
      for (const url of effective.servers ?? []) {
        const serverId = oauthSecretServerId(url);
        // Own-property reads: with a `__proto__` key a plain lookup on a
        // map that lacks it returns the inherited prototype, so a clear
        // would read as an update and skip the purge below.
        const next = getOwnEntry(snapshot.servers, url);
        // Candidates span the old and new shapes so a removed issuer's
        // fields are deleted, not orphaned in the store.
        const candidates = [
          ...new Set([
            ...serverSecretFields(getOwnEntry(disk?.servers, url)),
            ...serverSecretFields(next),
          ]),
        ];
        const entryPrior = await snapshotSecretFields(
          secretStore,
          serverId,
          candidates,
        );
        priorSecrets.push(...entryPrior);
        if (next === undefined) {
          // A failed purge propagates and aborts the write: committing a
          // file without the entry while its secrets may linger in the
          // store would orphan them, and re-adding the server later could
          // resurrect the stale credentials.
          await secretStore.deleteAllForServer(serverId);
          continue;
        }
        const { residue, secrets } = splitServerOAuthState(next, policy);
        // Own-property writes throughout: URL/issuer keys are untrusted
        // and "__proto__" would otherwise silently drop the residue.
        setOwnEntry(merged.servers, url, residue);
        if (!durable) {
          const diskEntry = getOwnEntry(disk?.servers, url);
          // Split the disk value with the *active* policy so the compare
          // is like-for-like: under `access` the raw disk blob still
          // carries its refresh token while `secrets` never does, and a
          // raw compare would wrongly treat the unchanged access token as
          // changed and strip the only durable copy.
          const keep = preserveNonDurableSecrets(
            diskEntry ? splitServerOAuthState(diskEntry, policy).secrets : {},
            secrets,
          );
          if (Object.keys(keep).length > 0) {
            setOwnEntry(
              merged.servers,
              url,
              joinServerOAuthState(residue, keep),
            );
          }
        }
        const persisted = await persistEntrySecrets(
          secretStore,
          serverId,
          candidates,
          secrets,
          entryPrior,
        );
        if (!persisted) revertEntryToDisk(merged.servers, disk?.servers, url);
      }

      for (const issuer of effective.idpSessions ?? []) {
        const serverId = oauthIdpSecretServerId(issuer);
        const next = getOwnEntry(snapshot.idpSessions, issuer);
        const entryPrior = await snapshotSecretFields(secretStore, serverId, [
          IDP_SESSION_FIELD,
        ]);
        priorSecrets.push(...entryPrior);
        if (next === undefined) {
          // Same as the server loop: a failed purge aborts the write.
          await secretStore.deleteAllForServer(serverId);
          continue;
        }
        const { residue, secrets } = splitIdpSession(next, policy);
        setOwnEntry(merged.idpSessions, issuer, residue);
        if (!durable) {
          const diskSession = getOwnEntry(disk?.idpSessions, issuer);
          const keep = preserveNonDurableSecrets(
            diskSession ? splitIdpSession(diskSession, policy).secrets : {},
            secrets,
          );
          if (Object.keys(keep).length > 0) {
            setOwnEntry(
              merged.idpSessions,
              issuer,
              joinIdpSession(residue, keep),
            );
          }
        }
        const persisted = await persistEntrySecrets(
          secretStore,
          serverId,
          [IDP_SESSION_FIELD],
          secrets,
          entryPrior,
        );
        if (!persisted)
          revertEntryToDisk(merged.idpSessions, disk?.idpSessions, issuer);
      }

      await writeStoreFile(filePath, serializeOAuthPersistBlob(merged));
    } catch (error) {
      await restoreSecretFields(
        secretStore,
        priorSecrets,
        warnStoreWriteFailure,
      );
      throw error;
    }
  });
}

/** Build the bulk-read request list for everything a snapshot could hold. */
function secretRequestsFor(
  snapshot: OAuthPersistSnapshot,
): SecretBulkRequest[] {
  const requests: SecretBulkRequest[] = [];
  for (const [url, state] of Object.entries(snapshot.servers)) {
    requests.push({
      serverId: oauthSecretServerId(url),
      fields: serverSecretFields(state),
    });
  }
  for (const issuer of Object.keys(snapshot.idpSessions)) {
    requests.push({
      serverId: oauthIdpSecretServerId(issuer),
      fields: [IDP_SESSION_FIELD],
    });
  }
  return requests;
}

/** Rejoin a residue snapshot with the store's values (store wins). */
async function joinSnapshot(
  snapshot: OAuthPersistSnapshot,
  secretStore: SecretStore,
): Promise<OAuthPersistSnapshot> {
  const requests = secretRequestsFor(snapshot);
  // Strict: this read hydrates the memory state that later sectioned writes
  // diff against, so a tolerant read during a store outage would present
  // every credential as absent — and the next save would *delete* them from
  // the store. An unreadable store must fail the read (5xx / failed load),
  // not masquerade as empty.
  const values =
    requests.length > 0
      ? await secretStoreGetManyStrict(secretStore, requests)
      : {};
  return {
    servers: Object.fromEntries(
      Object.entries(snapshot.servers).map(([url, state]) => [
        url,
        joinServerOAuthState(state, values[oauthSecretServerId(url)] ?? {}),
      ]),
    ),
    idpSessions: Object.fromEntries(
      Object.entries(snapshot.idpSessions).map(([issuer, session]) => [
        issuer,
        joinIdpSession(session, values[oauthIdpSecretServerId(issuer)] ?? {}),
      ]),
    ),
  };
}

/**
 * Lazily migrate a pre-split file: move its plaintext secrets into the
 * store and rewrite the file as residue. Runs inside the caller's file lock
 * (see {@link readOAuthStore}) and re-reads fresh under it, so a concurrent
 * writer's entries are not rolled back. Only when the store is
 * durable — stripping a file into a session-scoped store would trade secrets
 * that survive restarts for ones that die with the process. One-way; an
 * older Inspector version simply re-auths.
 *
 * Migration deliberately splits with `"all"`, not the active persist-tokens
 * policy: it *moves* existing credentials, it does not acquire new ones. The
 * documented contract is that already-persisted tokens still load and the
 * policy trims them on the next save — applying the policy here would make
 * the first read under `none`/`access` silently destroy tokens instead of
 * relocating them.
 *
 * Store-wins, like the mcp.json and client.json migrations: each field is
 * strict-read first and the plaintext is copied only where the store has no
 * *usable* value (see {@link isUsableStoredSecret} — a corrupt store entry
 * would be discarded by the read-side join, so it is replaced from the
 * plaintext rather than honored). The store can legitimately be ahead of a file that still carries
 * plaintext (a newer write whose residue commit failed, a hand-restored
 * file backup), and an unconditional copy would roll those credentials
 * back. The strict read means an unreadable store aborts the migration
 * (caught by the caller) rather than masquerading as absence.
 */
async function migratePlaintextSecrets(
  filePath: string,
  secretStore: SecretStore,
): Promise<void> {
  const fresh = parseOAuthPersistBlob(await readStoreFile(filePath));
  if (!fresh || !snapshotHasPlaintextSecrets(fresh)) return;
  const migrateEntrySecrets = async (
    serverId: string,
    secrets: OAuthSecretValues,
  ): Promise<void> => {
    const absent: Record<string, string> = {};
    for (const [field, value] of Object.entries(secrets)) {
      const existing = await secretStoreGetStrict(secretStore, serverId, field);
      // Store-wins only applies to a *usable* store value: a corrupt entry
      // would be discarded by the read-side join, so honoring it here would
      // strip valid plaintext and lose the credential. Replace it instead.
      if (existing === null || !isUsableStoredSecret(field, existing)) {
        absent[field] = value;
      }
    }
    if (Object.keys(absent).length > 0) {
      // Unlike the write path there is no memory copy to degrade to —
      // a failure here must abort the strip, so it throws. A partial
      // migration is self-healing: the file keeps its plaintext, the
      // next read retries, and the store-wins check absorbs the fields
      // that already landed.
      await secretStoreSetMany(secretStore, serverId, absent);
    }
  };
  const residue: OAuthPersistSnapshot = { servers: {}, idpSessions: {} };
  for (const [url, state] of Object.entries(fresh.servers)) {
    const split = splitServerOAuthState(state, "all");
    setOwnEntry(residue.servers, url, split.residue);
    await migrateEntrySecrets(oauthSecretServerId(url), split.secrets);
  }
  for (const [issuer, session] of Object.entries(fresh.idpSessions)) {
    const split = splitIdpSession(session, "all");
    setOwnEntry(residue.idpSessions, issuer, split.residue);
    await migrateEntrySecrets(oauthIdpSecretServerId(issuer), split.secrets);
  }
  await writeStoreFile(filePath, serializeOAuthPersistBlob(residue));
}

/**
 * Read the OAuth state file and rejoin it with the secret store. When the
 * file still carries plaintext secrets and the store is durable, they are
 * migrated first (see {@link migratePlaintextSecrets}); a failed migration
 * leaves the file untouched and the plaintext keeps working.
 *
 * The whole read — file read, lazy migration, and store join — runs under
 * the same file lock as writes, migration, and removal. An unlocked reader
 * could interleave with a writer that has updated the secret store but not
 * yet committed the new residue, and join the *old* residue (say, the old
 * `client_id`) with the *new* secrets — a torn read producing a mismatched
 * credential pair, distinct from the accepted long-lived-cache staleness.
 * A held lock surfaces as a retryable 503 (see {@link rethrowLockError}).
 */
export async function readOAuthStore(
  filePath: string,
  secretStore: SecretStore = defaultSecretStore(),
): Promise<OAuthPersistSnapshot | null> {
  return withOAuthStateLock(filePath, "read", async () => {
    let snapshot = parseOAuthPersistBlob(await readStoreFile(filePath));
    if (snapshot === null) return null;

    if (
      snapshotHasPlaintextSecrets(snapshot) &&
      (await secretStoreIsDurable(secretStore))
    ) {
      try {
        await migratePlaintextSecrets(filePath, secretStore);
        snapshot =
          parseOAuthPersistBlob(await readStoreFile(filePath)) ?? snapshot;
      } catch (error) {
        warnMigrationFailure(error);
      }
    }

    return joinSnapshot(snapshot, secretStore);
  });
}

/**
 * Delete the OAuth state file and every secret-store entry it indexes. The
 * file is read first because the store cannot enumerate its own entries —
 * the file's keys are the index. The read → purge → unlink sequence runs
 * under the same file lock as writes and migration, so a concurrent
 * sectioned write cannot interleave (which could either resurrect a
 * just-purged entry's residue or orphan its freshly written store secrets).
 *
 * A failed purge propagates and leaves the file in place: the file is the
 * only index of the store entries, so unlinking it while they may still
 * exist would strand credentials the next removal attempt could no longer
 * find. Every purged field is snapshotted first, so a failure partway
 * through the purges — or in the unlink itself — restores the store to
 * match the file that survives: the entry keeps working, and retrying the
 * removal still finds everything.
 */
export async function removeOAuthStore(
  filePath: string,
  secretStore: SecretStore = defaultSecretStore(),
): Promise<void> {
  await withOAuthStateLock(filePath, "remove", async () => {
    const snapshot = await readDiskForMutation(filePath, "remove");
    if (snapshot) {
      const targets = [
        ...Object.entries(snapshot.servers).map(([url, state]) => ({
          id: oauthSecretServerId(url),
          fields: serverSecretFields(state),
        })),
        ...Object.keys(snapshot.idpSessions).map((issuer) => ({
          id: oauthIdpSecretServerId(issuer),
          fields: [IDP_SESSION_FIELD],
        })),
      ];
      const priorSecrets: SecretFieldSnapshot[] = [];
      try {
        for (const { id, fields } of targets) {
          priorSecrets.push(
            ...(await snapshotSecretFields(secretStore, id, fields)),
          );
          await secretStore.deleteAllForServer(id);
        }
        await deleteStoreFile(filePath);
      } catch (error) {
        await restoreSecretFields(
          secretStore,
          priorSecrets,
          warnStoreWriteFailure,
        );
        throw error;
      }
    } else {
      await deleteStoreFile(filePath);
    }
  });
}

export function createFileOAuthPersistBackend(
  options: FileOAuthPersistBackendOptions,
): OAuthPersistBackend {
  const secretStore = options.secretStore ?? defaultSecretStore();
  return {
    async read() {
      return readOAuthStore(options.filePath, secretStore);
    },
    async write(snapshot, sections) {
      await writeOAuthSections(
        options.filePath,
        snapshot,
        sections,
        secretStore,
      );
    },
    async remove() {
      await removeOAuthStore(options.filePath, secretStore);
    },
  };
}
