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
 *    and IdP session tokens go to the {@link SecretStore}; the residue
 *    written to `oauth.json` carries no usable secret (a *type-corrupt*
 *    token payload from a hand-edited file stays in place so the entry
 *    remains clearable — see `splitTokens`). Reads rejoin the two and
 *    lazily migrate a pre-split plaintext file — stripping it only when the
 *    store is durable, the same guard the mcp.json/client.json migrations
 *    use. A store write failure degrades those tokens to memory-only with a
 *    loud warning; it never falls back to writing them into the file.
 * 3. **Secret-store namespace** (#2549): each state file carries a
 *    `secretsNamespace` UUID, baked into every secret-store id its entries
 *    use, so two state files (profiles) naming the same server hold
 *    separate store entries instead of overwriting one shared slot. The
 *    namespace is minted — and a legacy file's unscoped entries moved under
 *    it — on the file's first write (`adoptSecretsNamespace`); reads and
 *    removes honor whatever the file says and never adopt. A sidecar
 *    ledger (`oauth-namespace-ledger.ts`, #2560) records every namespace
 *    the file has used, so entries under one the file no longer carries —
 *    its stamp stripped by an older Inspector's save — are purged on the
 *    next locked adoption or removal instead of orphaned in the store.
 */

import {
  readStoreFile,
  writeStoreFile,
  deleteStoreFile,
} from "../../storage/store-io.js";
import { serializeStore } from "../../storage/store-serialize.js";
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
  SecretStoreUnavailableError,
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
  purgeSupersededNamespaces,
  recordNamespaceKeys,
} from "./oauth-namespace-ledger.js";
import { MAX_WRITE_ATTEMPTS } from "./file-secret-store.js";
import {
  IDP_SESSION_FIELD,
  getPersistTokensPolicy,
  isUsableStoredSecret,
  isValidSecretsNamespace,
  joinIdpSession,
  joinServerOAuthState,
  newSecretsNamespace,
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
 * Compensation-failure variant of {@link warnStoreWriteFailure}: here a
 * mutation already changed the secret store and the attempt to restore the
 * prior values failed, so the write-path message ("kept in memory for this
 * session") would be false — the prior values may be gone, and the store may
 * no longer agree with the file. Re-authorizing is the recovery, not a
 * restart-time inconvenience.
 */
function warnRestoreFailure(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  const key = `restore:${reason}`;
  if (warnedStoreFailures.has(key)) return;
  warnedStoreFailures.add(key);
  console.warn(
    `[mcp-inspector] Could not restore secret-store entries after a failed OAuth state write (${reason}). The secret store may be inconsistent with oauth.json; if a server's stored credentials stop working, re-authorize it.`,
  );
}

/**
 * Confirmation-failure variant of {@link warnRestoreFailure}: a file write
 * succeeded but was never confirmed by a read-back, a later step failed, and
 * the re-read that decides between "committed" and "rolled back" also
 * failed. The store was restored to the pre-write state — the bias that
 * cannot strand secrets — but the file may still hold the interrupted save.
 */
function warnUnconfirmedFile(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  const key = `unconfirmed:${reason}`;
  if (warnedStoreFailures.has(key)) return;
  warnedStoreFailures.add(key);
  console.warn(
    `[mcp-inspector] Could not re-read oauth.json after a failed OAuth state save (${reason}). The file may still contain the interrupted save while the secret store was restored to the previous values; if a server's stored credentials stop working, re-authorize it.`,
  );
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
  body: (locked: boolean) => Promise<T>,
): Promise<T> {
  let entered = false;
  try {
    return await withSecretFileLock(filePath, async (locked) => {
      entered = true;
      return body(locked);
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
 * Top-level state-file key holding the file's secrets namespace (#2549): a
 * UUID minted per state file and baked into every secret-store id the file's
 * entries use (see `oauthSecretServerId`). It is what keeps two state files
 * (profiles) that connect to the same server from sharing — and silently
 * overwriting — one store entry. Node-file-backend-only: the browser and
 * sessionStorage backends never see it ({@link parseOAuthPersistBlob}
 * ignores unknown keys), and every writer re-reads it from disk under the
 * file lock, so a snapshot round-tripped through the API cannot strip it.
 */
export const SECRETS_NAMESPACE_KEY = "secretsNamespace";

/**
 * Extract the secrets namespace from a raw state-file blob. Tolerant like
 * the read path: an unparseable file or an invalid value reads as "no
 * namespace" (legacy unscoped ids) rather than failing — an invalid value
 * must not reach store ids, where it could forge the `+` delimiter or break
 * the keyring's colon parse (see `isValidSecretsNamespace`).
 */
function parseSecretsNamespace(raw: string | null): string | undefined {
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const value = (parsed as Record<string, unknown>)[SECRETS_NAMESPACE_KEY];
    return isValidSecretsNamespace(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Serialize a snapshot for the state file, stamping the secrets namespace
 * first so it survives every rewrite (sectioned saves, the plaintext-secret
 * migration, adoption itself). Key order is fixed — namespace, then the
 * snapshot — because the write path compares raw file strings to detect
 * concurrent writers.
 */
function serializeOAuthFileBlob(
  snapshot: OAuthPersistSnapshot,
  namespace: string | undefined,
): string {
  if (namespace === undefined) return serializeOAuthPersistBlob(snapshot);
  return serializeStore({ [SECRETS_NAMESPACE_KEY]: namespace, ...snapshot });
}

/**
 * Cleanup-failure variant of {@link warnStoreWriteFailure}: namespace
 * adoption copied the legacy unscoped entries to their namespaced ids and
 * stamped the file, but deleting the legacy originals failed. Nothing is
 * lost — the namespaced ids are authoritative from here on — but the
 * leftovers sit in the store un-indexed (no state file will purge them) and
 * could serve stale credentials to a profile that has not adopted yet.
 */
function warnNamespaceCleanupFailure(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  const key = `namespace-cleanup:${reason}`;
  if (warnedStoreFailures.has(key)) return;
  warnedStoreFailures.add(key);
  console.warn(
    `[mcp-inspector] Could not remove legacy un-namespaced secret-store entries after scoping them to this state file (${reason}). This file uses the scoped copies, but another pre-namespace state file could still read the stale leftovers until it adopts or re-authorizes — and they will not be cleaned up automatically.`,
  );
}

/**
 * Ensure the state file has a secrets namespace, minting and stamping one —
 * and moving its legacy unscoped store entries under it — when it does not
 * (#2549). Runs under the caller's file lock, on the mutation path only:
 * reads keep working against whatever the file currently says, so a
 * pre-adoption profile loses nothing until it first writes.
 *
 * For a legacy file (recognized, entries, no namespace) the move is
 * copy → stamp → delete, in that order, because each step's failure mode
 * differs:
 *
 * - **Copy** (legacy id → namespaced id) lands on vacant scoped ids — the
 *   namespace is freshly minted, so nothing can already live under it. A
 *   failure deletes the copies it made and rethrows — the file is
 *   unstamped, so everything still resolves through the legacy ids and
 *   the next write retries under a new UUID.
 * - **Stamp** (rewrite the file with the namespace) is the commit point: a
 *   failure triggers the same restore, because a successful copy with no
 *   stamp would be re-run under a *different* UUID next time, stranding
 *   this one's copies forever.
 * - **Delete** (the legacy originals) is best-effort after the commit: the
 *   namespaced ids are already authoritative for this file, so a failure
 *   here never loses a token — but the leftovers are not harmless to
 *   everyone: they are unindexed here, and a pre-namespace profile could
 *   still read them as stale credentials until it adopts or re-authorizes
 *   ({@link warnNamespaceCleanupFailure}). Deleting is deliberate, not
 *   cautious copying: the legacy entry is exactly the shared slot this
 *   change exists to retire, and `removeOAuthStore` purges by the file's
 *   own ids, so a leftover would otherwise be orphaned forever. Another
 *   profile still reading the legacy ids re-authorizes once — its copy of
 *   those tokens was already being overwritten by every other profile,
 *   which is the bug.
 *
 * A fresh file (absent, or no entries on disk) just mints: the namespace
 * reaches disk with the write that follows, and there is nothing to move.
 *
 * Migration requires the real file lock (`locked`). The move deletes its
 * sources, so two unlocked adopters racing on one legacy file can each
 * observe the other's half-finished move — one copies and deletes, the
 * other strict-reads nothing, stamps an empty namespace of its own, and
 * can win the file, stranding the first's copies under an abandoned
 * namespace. Under the lock adopters serialize (the second sees the
 * first's stamp and returns it); degraded, this refuses the one-time
 * migration loudly rather than risking that loss. Mint-only adoption —
 * a file that is absent, or recognized but indexing no entries — stays
 * allowed unlocked: there is nothing to move, and a concurrent
 * mint converges via the namespace re-key in `writeOAuthSections`.
 *
 * Under the lock, adoption first purges every namespace the ledger records
 * (#2560): reaching this point means the file carries none, so each
 * recorded one is superseded — most often a stamp an older Inspector's save
 * stripped, whose entries nothing else would ever find. Unlocked, the purge
 * is skipped: a concurrent adopter's namespace can be recorded before it is
 * stamped, and purging it would delete live credentials.
 */
async function adoptSecretsNamespace(
  filePath: string,
  secretStore: SecretStore,
  locked: boolean,
): Promise<string> {
  const raw = await readStoreFile(filePath);
  const existing = parseSecretsNamespace(raw);
  if (existing !== undefined) return existing;
  const snapshot = parseOAuthPersistBlob(raw);
  if (raw !== null && snapshot === null) {
    throw new OAuthStateFileUnrecognizedError(filePath, "save");
  }
  if (locked) {
    await purgeSupersededNamespaces(filePath, secretStore, undefined);
  }
  const namespace = newSecretsNamespace();
  if (snapshot === null) return namespace;

  const moves = [
    ...Object.entries(snapshot.servers).map(([url, state]) => ({
      legacyId: oauthSecretServerId(url),
      scopedId: oauthSecretServerId(url, namespace),
      fields: serverSecretFields(state),
    })),
    ...Object.keys(snapshot.idpSessions).map((issuer) => ({
      legacyId: oauthIdpSecretServerId(issuer),
      scopedId: oauthIdpSecretServerId(issuer, namespace),
      fields: [IDP_SESSION_FIELD],
    })),
  ];
  // A recognized but entry-less legacy file indexes no store ids, so no
  // destructive race exists — it mints like a fresh file, locked or not
  // (the save that follows writes the namespace to disk).
  if (moves.length === 0) return namespace;
  if (!locked) {
    throw new SecretStoreUnavailableError(
      `Could not save OAuth state: ${filePath} predates per-state-file secret namespaces, and migrating its secret-store entries needs the file lock, which is unavailable here (see the lock warning above). Migrating without it could lose credentials if two processes migrate at once. Nothing was changed; make the lock directory writable and retry — or, if you cannot, clear this file's stored OAuth state and re-authorize (clearing does not migrate, and the fresh state file mints its namespace without the lock).`,
    );
  }

  // Recorded before the copies, so an interrupted move's copies are still
  // findable if this namespace is later superseded.
  await recordNamespaceKeys(
    filePath,
    namespace,
    Object.keys(snapshot.servers),
    Object.keys(snapshot.idpSessions),
  );
  // Rollback baseline: the scoped ids are vacant before this call — the
  // namespace is a UUID minted moments ago, so nothing can already live
  // under it — which makes "restore" simply "delete what we copied".
  const touched: SecretFieldSnapshot[] = [];
  try {
    for (const { legacyId, scopedId, fields } of moves) {
      for (const field of fields) {
        const value = await secretStoreGetStrict(secretStore, legacyId, field);
        if (value === null) continue;
        touched.push({ serverId: scopedId, field, value: null });
        await secretStore.set(scopedId, field, value);
      }
    }
    await writeStoreFile(filePath, serializeOAuthFileBlob(snapshot, namespace));
  } catch (error) {
    await restoreSecretFields(secretStore, touched, warnRestoreFailure);
    throw error;
  }
  // Per-id catch: one failed purge must not abandon the remaining legacy
  // ids — each gets its own best-effort attempt.
  for (const { legacyId } of moves) {
    try {
      await secretStore.deleteAllForServer(legacyId);
    } catch (error) {
      warnNamespaceCleanupFailure(error);
    }
  }
  return namespace;
}

/**
 * Persist one entry's secrets: set every post-split value that *differs*
 * from its snapshotted store value, delete every candidate field the split
 * no longer produces *that the store still holds* (clears and policy
 * downgrades propagate as deletions). Returns whether the new state was
 * persisted.
 *
 * Only deltas touch the store. The `prior` snapshot is a strict per-field
 * read taken under the same lock, so a field whose desired value equals it
 * needs no write and an absent field needs no delete — and a *redundant*
 * mutation failing (say, a keychain that turned read-only) must not take
 * unrelated state down with it: without the filter, a scope-only save that
 * rewrote an unchanged token batch and failed would degrade the whole
 * entry to memory-only (or abort on a redundant delete) even though the
 * store already held exactly the desired state.
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
 * the session.
 *
 * That contract is only sound on a *first* attempt (`allowDegrade`), where
 * the disk entry really is the pre-call state the priors pair with. On a
 * retry the disk may already hold an earlier attempt's committed residue —
 * "reverting" to it while restoring pre-call secrets would pair a new
 * `client_id` with the old `client_secret` and report success — so a retry
 * escalates instead: the error is rethrown without compensation here, and
 * the caller's reconciling exit decides against the file (see
 * `writeOAuthSections`), whose whole-attempt rollback covers these fields.
 *
 * When the degrade compensation itself cannot be confirmed the write
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
  allowDegrade: boolean,
): Promise<boolean> {
  const priorValue = new Map(prior.map(({ field, value }) => [field, value]));
  const changed: Record<string, string> = {};
  for (const [field, value] of Object.entries(secrets)) {
    if (priorValue.get(field) !== value) changed[field] = value;
  }
  try {
    if (Object.keys(changed).length > 0) {
      await secretStoreSetMany(store, serverId, changed);
    }
  } catch (error) {
    if (!allowDegrade) throw error;
    warnStoreWriteFailure(error);
    // Restore only the fields the batch could have touched: an untouched
    // field's restore cannot help, but its failure would abort needlessly.
    const touched = prior.filter(({ field }) => changed[field] !== undefined);
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
      .filter(
        (field) =>
          secrets[field] === undefined && priorValue.get(field) !== null,
      )
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
  await withOAuthStateLock(filePath, "save", async (locked) => {
    // The namespace scoping every store id below; minted (and legacy
    // entries moved — under the real lock only, see adoptSecretsNamespace)
    // on this file's first namespaced write. Resolved once per save: an
    // attempt retry never re-ADOPTS — but it may re-KEY. Under degraded
    // (unlocked) locking a concurrent first writer can mint a different
    // namespace and win the file between this read and an attempt's write,
    // so each attempt below re-checks the namespace observed on disk and
    // converges onto it (`let`, not `const`).
    let namespace = await adoptSecretsNamespace(filePath, secretStore, locked);
    // Restore baseline for every failure exit below. For each touched
    // (server, field) it holds the latest store value NOT written by this
    // call: the pre-operation value, superseded by a concurrent writer's
    // value when one lands between attempts. An individual attempt's priors
    // would not do — from the second attempt on they observe the values
    // *earlier attempts* wrote, and restoring those treats an intermediate
    // attempt as committed: a brand-new entry's secrets would stay in the
    // store with no file index for `removeOAuthStore` to find.
    const restoreBaseline = new Map<string, SecretFieldSnapshot>();
    // What this call writes per (server, field) — constant across attempts,
    // because `secrets` derives from the caller's snapshot and the policy,
    // never from disk; a candidate outside `secrets` is deleted (null).
    // This is what lets the fold below tell "our own earlier attempt's
    // write" apart from "a concurrent writer's newer value".
    const ourWrites = new Map<string, string | null>();
    const priorKey = (p: { serverId: string; field: string }): string =>
      `${p.serverId}\u0000${p.field}`;
    const foldPriors = (priors: SecretFieldSnapshot[]): void => {
      for (const prior of priors) {
        const key = priorKey(prior);
        // A prior equal to what this call writes is an earlier attempt's own
        // work (or an indistinguishable identical write) — the baseline
        // already holds the right older value. Anything else is a value this
        // call did not write: the newest state a restore must not clobber.
        if (
          restoreBaseline.has(key) &&
          ourWrites.get(key) !== undefined &&
          prior.value === ourWrites.get(key)
        ) {
          continue;
        }
        restoreBaseline.set(key, prior);
      }
    };
    const restoreToBaseline = (): Promise<void> =>
      restoreSecretFields(
        secretStore,
        [...restoreBaseline.values()],
        warnRestoreFailure,
      );
    // The last file write that succeeded but was never confirmed by a
    // read-back, with the store writes its attempt actually committed
    // (degraded entries excluded — their store fields deliberately stayed at
    // their prior values, matching the reverted residue in the file). A
    // later failure does not prove that write gone: a read-back failure
    // followed by a failed retry (both reads breaking on the same sick
    // filesystem) leaves the file holding it, and rolling back only the
    // store would pair committed residue with restored old secrets.
    let unconfirmed: {
      written: string;
      writes: Map<
        string,
        { serverId: string; field: string; value: string | null }
      >;
    } | null = null;
    // Every failure exit funnels through this one decision procedure:
    // re-read the file first. If it still holds the unconfirmed write, the
    // save *is* committed — re-point the store at exactly the pairing that
    // file holds: the committed attempt's writes for the entries it
    // persisted, and the baseline values for every other touched field
    // (an entry the committed attempt degraded kept its pre-call residue,
    // and a later attempt's store writes for it must not survive under it).
    // Only a file confirmed to hold something else — or never written to —
    // rolls the store back to the fold baseline. An unreadable file cannot
    // confirm either way; restoring then biases toward store-behind
    // (missing tokens re-authorize, the file still indexes them) over
    // store-ahead (secrets stranded with no index), and says so. Returns
    // whether the caller should report success.
    const reconcileFailure = async (): Promise<boolean> => {
      if (unconfirmed !== null) {
        const committed = unconfirmed;
        let observed: string | null = null;
        let readable = true;
        try {
          observed = await readStoreFile(filePath);
        } catch (error) {
          readable = false;
          warnUnconfirmedFile(error);
        }
        if (readable && observed === committed.written) {
          const target = new Map(
            [...restoreBaseline].map(([key, { serverId, field, value }]) => [
              key,
              { serverId, field, value },
            ]),
          );
          for (const [key, write] of committed.writes) target.set(key, write);
          try {
            await settleStoreMutations(
              [...target.values()].map(({ serverId, field, value }) =>
                value === null
                  ? secretStore.delete(serverId, field)
                  : secretStore.set(serverId, field, value),
              ),
            );
            return true;
          } catch (error) {
            // The file is committed but the store could not be re-pointed
            // at it; restoring the baseline would contradict the file, so
            // warn and let the caller throw — a retried save converges.
            warnRestoreFailure(error);
            return false;
          }
        }
      }
      await restoreToBaseline();
      return false;
    };
    // Read-merge-write plus a verifying read, re-applied when another writer
    // lands in between — the same convergence pattern, with the same attempt
    // budget, as `FileSecretStore.mutateLocked` (see its doc for why a
    // verify is needed at all: `withSecretFileLock` deliberately degrades to
    // an unlocked run when the lock cannot be created, and even a held lock
    // says nothing about writers outside this codebase). Without it, two
    // processes on a lock-hostile filesystem could each read the same file,
    // and the later atomic write would clobber the earlier one's sections
    // with both reporting success.
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
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
      // What this attempt actually committed to the store, keyed like
      // `ourWrites` — deletion branches after the purge lands, persisted
      // entries after `persistEntrySecrets` succeeds, degraded entries
      // excluded (their store fields stayed at prior values, matching the
      // reverted residue). Attached to `unconfirmed` when the file write
      // lands, so a reconciling exit can re-point the store at exactly the
      // set the committed file pairs with.
      const attemptWrites = new Map<
        string,
        { serverId: string; field: string; value: string | null }
      >();
      // Set inside the try (the residue overlay below mutates `merged`, so it
      // can only be serialized after the entry loops); read by the verify
      // below, which the catch's rethrow can never reach unassigned.
      let written: string;

      // The disk read sits inside the try too: on a retry the store already
      // holds an earlier attempt's writes, and a concurrent writer replacing
      // the file with something unrecognized would otherwise throw past the
      // loop without any rollback. Read raw, not just parsed: the namespace
      // check below needs the unparsed blob.
      try {
        const rawDisk = await readStoreFile(filePath);
        const disk = parseOAuthPersistBlob(rawDisk);
        if (rawDisk !== null && disk === null) {
          throw new OAuthStateFileUnrecognizedError(filePath, "save");
        }
        // Namespace convergence: under degraded (unlocked) locking a
        // concurrent first writer can adopt a different namespace and win
        // the file after our adoption read. The merge below already
        // converges the *data* onto what they left; the namespace must
        // converge the same way, or every retry re-stamps our own mint and
        // the two writers ping-pong, stranding the loser's secrets under a
        // namespace the final file no longer references. Re-key to the
        // namespace observed on disk, first rolling earlier attempts' store
        // writes (all keyed under the abandoned namespace) back to baseline.
        const diskNamespace = parseSecretsNamespace(rawDisk);
        if (diskNamespace !== undefined && diskNamespace !== namespace) {
          // Strict, unlike the failure exits' best-effort restores: this is
          // normal control flow with no original error to preserve, and
          // carrying on past a failed restore would clear the baseline and
          // let the save report success with earlier attempts' writes
          // stranded under the abandoned namespace, unindexed by any file.
          // Aborting keeps the baseline for the rethrow's reconciliation,
          // and a retried save converges cleanly.
          let restoreFailure: unknown;
          await restoreSecretFields(
            secretStore,
            [...restoreBaseline.values()],
            (error) => {
              restoreFailure ??= error;
            },
          );
          if (restoreFailure !== undefined) throw restoreFailure;
          restoreBaseline.clear();
          ourWrites.clear();
          // Our unconfirmed write carried the abandoned namespace, and the
          // read above proves the file no longer holds it.
          unconfirmed = null;
          namespace = diskNamespace;
        }
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
        // Ledger before store writes (#2560): an entry written under this
        // namespace must be findable once the namespace is superseded.
        await recordNamespaceKeys(
          filePath,
          namespace,
          Object.keys(merged.servers),
          Object.keys(merged.idpSessions),
        );

        for (const url of effective.servers ?? []) {
          const serverId = oauthSecretServerId(url, namespace);
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
            for (const field of candidates) {
              ourWrites.set(priorKey({ serverId, field }), null);
            }
            await secretStore.deleteAllForServer(serverId);
            for (const field of candidates) {
              attemptWrites.set(priorKey({ serverId, field }), {
                serverId,
                field,
                value: null,
              });
            }
            continue;
          }
          const { residue, secrets } = splitServerOAuthState(next, policy);
          for (const field of candidates) {
            ourWrites.set(
              priorKey({ serverId, field }),
              secrets[field] ?? null,
            );
          }
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
            // Degrading is only sound when the disk entry is the pre-call
            // state this attempt's priors pair with; on a retry it may be an
            // earlier attempt's committed residue, so escalate into the
            // reconciling exit instead.
            attempt === 0,
          );
          if (!persisted) {
            revertEntryToDisk(merged.servers, disk?.servers, url);
            continue;
          }
          for (const field of candidates) {
            attemptWrites.set(priorKey({ serverId, field }), {
              serverId,
              field,
              value: secrets[field] ?? null,
            });
          }
        }

        for (const issuer of effective.idpSessions ?? []) {
          const serverId = oauthIdpSecretServerId(issuer, namespace);
          const next = getOwnEntry(snapshot.idpSessions, issuer);
          const entryPrior = await snapshotSecretFields(secretStore, serverId, [
            IDP_SESSION_FIELD,
          ]);
          priorSecrets.push(...entryPrior);
          if (next === undefined) {
            // Same as the server loop: a failed purge aborts the write.
            ourWrites.set(
              priorKey({ serverId, field: IDP_SESSION_FIELD }),
              null,
            );
            await secretStore.deleteAllForServer(serverId);
            attemptWrites.set(
              priorKey({ serverId, field: IDP_SESSION_FIELD }),
              {
                serverId,
                field: IDP_SESSION_FIELD,
                value: null,
              },
            );
            continue;
          }
          const { residue, secrets } = splitIdpSession(next, policy);
          ourWrites.set(
            priorKey({ serverId, field: IDP_SESSION_FIELD }),
            secrets[IDP_SESSION_FIELD] ?? null,
          );
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
            // Same as the server loop: degrade on the first attempt only.
            attempt === 0,
          );
          if (!persisted) {
            revertEntryToDisk(merged.idpSessions, disk?.idpSessions, issuer);
            continue;
          }
          attemptWrites.set(priorKey({ serverId, field: IDP_SESSION_FIELD }), {
            serverId,
            field: IDP_SESSION_FIELD,
            value: secrets[IDP_SESSION_FIELD] ?? null,
          });
        }

        written = serializeOAuthFileBlob(merged, namespace);
        await writeStoreFile(filePath, written);
        unconfirmed = { written, writes: attemptWrites };
      } catch (error) {
        // Fold this attempt's priors first: a concurrent writer's value
        // observed at the start of this attempt supersedes the baseline's,
        // and a field first seen this attempt has no baseline entry yet.
        foldPriors(priorSecrets);
        if (await reconcileFailure()) return;
        throw error;
      }
      foldPriors(priorSecrets);

      // The verify sits outside the try: the file write above succeeded, so
      // the store and the file are consistent and a failure to *read back*
      // must not roll the store to its prior values.
      let observed: string | null;
      try {
        observed = await readStoreFile(filePath);
      } catch {
        // Wrote successfully but cannot read it back; claiming convergence
        // would be a guess. Retry; the write stays in `unconfirmed`, so a
        // failing retry reconciles against it instead of assuming it gone.
        continue;
      }
      if (observed === written) return;
      // Someone wrote between our write and our read-back — the file is
      // confirmed to no longer hold this attempt's write. Loop: the next
      // attempt re-reads and re-merges onto what they left.
      unconfirmed = null;
    }
    if (await reconcileFailure()) return;
    throw new SecretStoreUnavailableError(
      `Could not save OAuth state: another process kept overwriting ${filePath} (gave up after ${MAX_WRITE_ATTEMPTS} attempts). Re-run the action to retry.`,
    );
  });
}

/** Build the bulk-read request list for everything a snapshot could hold. */
function secretRequestsFor(
  snapshot: OAuthPersistSnapshot,
  namespace: string | undefined,
): SecretBulkRequest[] {
  const requests: SecretBulkRequest[] = [];
  for (const [url, state] of Object.entries(snapshot.servers)) {
    requests.push({
      serverId: oauthSecretServerId(url, namespace),
      fields: serverSecretFields(state),
    });
  }
  for (const issuer of Object.keys(snapshot.idpSessions)) {
    requests.push({
      serverId: oauthIdpSecretServerId(issuer, namespace),
      fields: [IDP_SESSION_FIELD],
    });
  }
  return requests;
}

/** Rejoin a residue snapshot with the store's values (store wins). */
async function joinSnapshot(
  snapshot: OAuthPersistSnapshot,
  secretStore: SecretStore,
  namespace: string | undefined,
): Promise<OAuthPersistSnapshot> {
  const requests = secretRequestsFor(snapshot, namespace);
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
        joinServerOAuthState(
          state,
          values[oauthSecretServerId(url, namespace)] ?? {},
        ),
      ]),
    ),
    idpSessions: Object.fromEntries(
      Object.entries(snapshot.idpSessions).map(([issuer, session]) => [
        issuer,
        joinIdpSession(
          session,
          values[oauthIdpSecretServerId(issuer, namespace)] ?? {},
        ),
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
  const raw = await readStoreFile(filePath);
  const fresh = parseOAuthPersistBlob(raw);
  if (!fresh || !snapshotHasPlaintextSecrets(fresh)) return;
  // Migration honors — and preserves — the file's own namespace; it never
  // mints one. Scoping is a write-path decision (`adoptSecretsNamespace`),
  // and a read-triggered strip that also re-keyed the entries would be the
  // adoption without its legacy-entry move.
  const namespace = parseSecretsNamespace(raw);
  if (namespace !== undefined) {
    await recordNamespaceKeys(
      filePath,
      namespace,
      Object.keys(fresh.servers),
      Object.keys(fresh.idpSessions),
    );
  }
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
    await migrateEntrySecrets(
      oauthSecretServerId(url, namespace),
      split.secrets,
    );
  }
  for (const [issuer, session] of Object.entries(fresh.idpSessions)) {
    const split = splitIdpSession(session, "all");
    setOwnEntry(residue.idpSessions, issuer, split.residue);
    await migrateEntrySecrets(
      oauthIdpSecretServerId(issuer, namespace),
      split.secrets,
    );
  }
  // The split leaves only type-corrupt token payloads in the residue (see
  // `splitTokens`), so a hand-edited junk entry stays plaintext and
  // clearable instead of being stripped into a store value the join would
  // reject. Such a file re-enters migration on every read; skip the rewrite
  // when nothing would change so a steady-state file is not re-written (and
  // a concurrent writer not clobbered) per read.
  const stripped = serializeOAuthFileBlob(residue, namespace);
  if (stripped !== raw) {
    await writeStoreFile(filePath, stripped);
  }
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
 *
 * Where the lock cannot be created at all, `withSecretFileLock` runs the
 * body unlocked (announcing so once on the console) and this protection is
 * genuinely absent — stated rather than oversold, as with the residual in
 * `FileSecretStore.mutate`. No read-side verification can close it: the
 * tear is this read landing inside another process's store-write →
 * file-write window, and until that writer commits its file there is
 * nothing observable to re-check. The tear is also transient, not
 * persisted corruption — the next read after the writer commits joins a
 * consistent pair, and persisted state itself still converges via the
 * write path's read-back verification in {@link writeOAuthSections}.
 */
export async function readOAuthStore(
  filePath: string,
  secretStore: SecretStore = defaultSecretStore(),
): Promise<OAuthPersistSnapshot | null> {
  return withOAuthStateLock(filePath, "read", async () => {
    let raw = await readStoreFile(filePath);
    let snapshot = parseOAuthPersistBlob(raw);
    if (snapshot === null) return null;

    if (
      snapshotHasPlaintextSecrets(snapshot) &&
      (await secretStoreIsDurable(secretStore))
    ) {
      try {
        await migratePlaintextSecrets(filePath, secretStore);
        raw = await readStoreFile(filePath);
        snapshot = parseOAuthPersistBlob(raw) ?? snapshot;
      } catch (error) {
        warnMigrationFailure(error);
      }
    }

    // Reads never adopt: a legacy file's entries stay at their legacy ids
    // until a write mints the namespace and moves them (#2549).
    return joinSnapshot(snapshot, secretStore, parseSecretsNamespace(raw));
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
  await withOAuthStateLock(filePath, "remove", async (locked) => {
    const rawBlob = await readStoreFile(filePath);
    const snapshot = parseOAuthPersistBlob(rawBlob);
    if (rawBlob !== null && snapshot === null) {
      throw new OAuthStateFileUnrecognizedError(filePath, "remove");
    }
    if (snapshot) {
      // Purge by the ids this file's entries actually use. A legacy
      // (un-namespaced) file purges the legacy ids; a namespaced one must
      // purge ONLY its own namespaced ids — the legacy ids may still be the
      // live index of another, not-yet-adopted state file (#2549).
      const namespace = parseSecretsNamespace(rawBlob);
      const targets = [
        ...Object.entries(snapshot.servers).map(([url, state]) => ({
          id: oauthSecretServerId(url, namespace),
          fields: serverSecretFields(state),
        })),
        ...Object.keys(snapshot.idpSessions).map((issuer) => ({
          id: oauthIdpSecretServerId(issuer, namespace),
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
          warnRestoreFailure,
        );
        throw error;
      }
    } else {
      await deleteStoreFile(filePath);
    }
    // The file is gone, so every namespace the ledger records is now
    // superseded — including ones an older Inspector's save stripped from
    // it, which the purge above could not see (#2560). Locked only, for the
    // reason adoption gives.
    if (locked) {
      await purgeSupersededNamespaces(filePath, secretStore, undefined);
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
