/**
 * The secrets-namespace ledger (#2560): a sidecar to the OAuth state file
 * recording every secrets namespace that file has used, and which server
 * URLs and IdP issuers have had store entries written under each one.
 *
 * Why a sidecar and not a key in the state file: the `secretsNamespace`
 * stamp (#2549) does not survive a save by an Inspector older than it
 * (≤ 2.9.x), whose parse → serialize round trip drops unknown keys. The
 * next save by a current Inspector then sees an unstamped file and
 * re-adopts under a fresh UUID, and the previous namespace's entries —
 * possibly still-valid refresh tokens in the OS keychain — are left with
 * no state file referencing them. Anything recorded *inside* `oauth.json`
 * is lost the same way, so the record lives beside it, where an old
 * version never looks.
 *
 * Why it records keys and not just the namespace: the store cannot be
 * enumerated on every backend (the keyring cannot list), so a purge has to
 * name each id it deletes. And the stripped file is not a sufficient index
 * of what lived under the old namespace — the old version may have removed
 * servers in the meantime. So keys are recorded *before* their entries are
 * written; recording extra is harmless (purging an id that holds nothing
 * is a no-op), recording too little is the leak this exists to close.
 *
 * Why keys are recorded per store *location*: the backend is selected per
 * run, and a run can land on a different one than the run that wrote the
 * entries (a locked keychain falling back to `secrets.json`, an explicit
 * `MCP_INSPECTOR_SECRET_STORE` switch). Deleting from the wrong backend
 * succeeds against nothing, and dropping the record on that "success"
 * would strand the real entries for good. So a record is dropped only by a
 * purge in the location it was written to, and survives every other run
 * until one of those comes along — except that a `secrets.json` record is
 * handed to the keychain record rather than dropped, because a
 * file-to-keychain hand-off may already have copied its entries there.
 *
 * Why a record can carry a pending carry-over (#2672): an adoption reads
 * the namespaces it supersedes through the run's own store only, so a
 * record in another location was never carried into its successor — and
 * the successor's stamp means no read falls back to it again. Purging it
 * from its own location later would delete what may be the only copy of a
 * confidential client's secret. So every record also notes, as each save
 * writes it, the `client_id` each client-credential field belongs to, and
 * adoption marks every record it could not read as owed to the namespace
 * that superseded it. A run in that location then reads, and finally
 * copies, those fields into the successor before the purge — but only
 * where the state file still holds a client with that same `client_id`. A
 * field the successor lacks is otherwise indistinguishable from one
 * deliberately cleared since, and a different `client_id` means the secret
 * would be paired with the wrong client. The owner is the one recorded at
 * write time, never inferred from the file being adopted: an older
 * Inspector may have re-registered in between. A record written before
 * owners were recorded has none, so nothing is carried from it.
 *
 * Everything else here is best-effort and never throws: the ledger is a cleanup
 * aid, not part of the credential path, so a failure warns once and the
 * save or removal it rides on carries on. Purging deletes credentials, so
 * the callers in `oauth-persist-file.ts` run it only under the real file
 * lock — an unlocked purge could delete a concurrent adopter's live
 * entries.
 */

import { resolve } from "node:path";
import {
  deleteStoreFile,
  readStoreFile,
  writeStoreFile,
} from "../../storage/store-io.js";
import { serializeStore } from "../../storage/store-serialize.js";
import {
  KeyringSecretStore,
  secretStoreGetStrict,
  type SecretStore,
} from "./secret-store.js";
import { FileSecretStore } from "./file-secret-store.js";
import { resolveConcreteSecretStore } from "./secret-store-selection.js";
import {
  isValidSecretsNamespace,
  oauthIdpSecretServerId,
  oauthSecretServerId,
} from "./oauth-secrets.js";

/** The ledger's path, derived from the state file it belongs to. */
export const namespaceLedgerPath = (stateFilePath: string): string =>
  `${stateFilePath}.namespaces.json`;

const KEYRING_LOCATION = "keyring";
const FILE_LOCATION_PREFIX = "file:";

/**
 * Where a store's entries live, as a stable string another process can
 * compare: the OS keychain, one particular `secrets.json`, or RAM (the
 * test doubles and the session-scoped container fallback — entries there
 * die with the process, so purging them from any memory store is moot).
 * Production stores arrive wrapped (`defaultSecretStore()`), so the
 * concrete selection is resolved first; the wrapper itself names nothing.
 */
export async function secretStoreLocation(store: SecretStore): Promise<string> {
  const concrete = await resolveConcreteSecretStore(store);
  if (concrete instanceof KeyringSecretStore) return KEYRING_LOCATION;
  if (concrete instanceof FileSecretStore) {
    return `${FILE_LOCATION_PREFIX}${resolve(concrete.filePath)}`;
  }
  return "memory";
}

/**
 * The recorded locations a purge from `location` covers: always its own,
 * and — for a keychain run — every `secrets.json` record too, because the
 * file-to-keychain hand-off (`absorbFileSecretsIntoKeyring`) copies a
 * file's entries, superseded namespaces included, into the keychain
 * without telling any ledger. Deleting ids that were never copied is a
 * no-op.
 *
 * Only the run's own record is ever dropped. A keychain run cannot know
 * whether a hand-off is still copying, was interrupted, or left the file
 * in place, so a `file:` record it purges stays recorded and is purged
 * again on the next locked save; it is consumed only by a run against that
 * file — and then folded into the keychain record rather than forgotten
 * (see {@link purgeSupersededNamespaces}), since copies may already sit in
 * the keychain.
 */
function coveredLocations(
  location: string,
  byLocation: Map<string, LedgerKeys>,
): Array<{ location: string; keys: LedgerKeys }> {
  return [...byLocation]
    .filter(
      ([recorded]) =>
        recorded === location ||
        (location === KEYRING_LOCATION &&
          recorded.startsWith(FILE_LOCATION_PREFIX)),
    )
    .map(([recorded, keys]) => ({ location: recorded, keys }));
}

/**
 * Per server URL, the `client_id` each client-credential field belonged to
 * (see `clientCredentialOwners`). Field names are keyed by issuer and come
 * from persisted state, so these are maps rather than plain objects.
 */
export type ClientCredentialOwners = Map<string, Map<string, string>>;

/**
 * The keys one namespace has had store entries written under, the client
 * each client credential written there belongs to, and — for a record an
 * adoption could not read (#2672) — the namespace it is owed to.
 */
interface LedgerKeys {
  servers: Set<string>;
  idpSessions: Set<string>;
  owners: ClientCredentialOwners;
  owedTo?: string;
}

const emptyKeys = (): LedgerKeys => ({
  servers: new Set(),
  idpSessions: new Set(),
  owners: new Map(),
});

/**
 * Fold `other`'s owners into `own`'s, for a server `own` has never been
 * written for only (#2672). Where `own` has, the value its store holds
 * for a field may be its own write's or one a hand-off filled in, and its
 * owners alone say which: an owner names the client of a value it wrote,
 * and a missing one — a vacant field, or a record from before owners were
 * kept — is ambiguous, so nothing is carried rather than guessed.
 */
function foldOwners(
  own: LedgerKeys | undefined,
  other: ClientCredentialOwners,
): ClientCredentialOwners {
  const owners: ClientCredentialOwners = new Map();
  for (const [url, fields] of other) {
    if (!own?.servers.has(url)) owners.set(url, new Map(fields));
  }
  mergeOwners(owners, own?.owners ?? new Map());
  return owners;
}

/**
 * The owners a run in `location` should trust for one namespace's
 * credentials (#2672): its own record's, plus a covered secrets file's
 * for servers its own record was never written for — a value the
 * file-to-keychain hand-off can only have brought from that file.
 */
function effectiveOwners(
  location: string,
  byLocation: Map<string, LedgerKeys>,
): ClientCredentialOwners {
  const fromFiles: ClientCredentialOwners = new Map();
  for (const { location: recorded, keys } of coveredLocations(
    location,
    byLocation,
  )) {
    if (recorded !== location) mergeOwners(fromFiles, keys.owners);
  }
  return foldOwners(byLocation.get(location), fromFiles);
}

/** Merge `source` into `target`, the later owner winning; reports a change. */
function mergeOwners(
  target: ClientCredentialOwners,
  source: ClientCredentialOwners,
): boolean {
  let changed = false;
  for (const [url, fields] of source) {
    const kept = target.get(url) ?? new Map<string, string>();
    for (const [field, clientId] of fields) {
      if (kept.get(field) === clientId) continue;
      kept.set(field, clientId);
      changed = true;
    }
    if (kept.size > 0) target.set(url, kept);
  }
  return changed;
}

/**
 * Namespace → store location → its keys. Namespaces are validated, and
 * both maps serialize through `Object.fromEntries`, so a hostile key such
 * as `__proto__` stays an own property rather than touching a prototype.
 */
type Ledger = Map<string, Map<string, LedgerKeys>>;

const warnedLedgerFailures = new Set<string>();

function warnLedgerFailure(what: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  const key = `${what}:${reason}`;
  if (warnedLedgerFailures.has(key)) return;
  warnedLedgerFailures.add(key);
  console.warn(
    `[mcp-inspector] Could not ${what} the OAuth secrets-namespace ledger (${reason}). OAuth state is unaffected, but secret-store entries left behind if this state file's namespace is ever lost (for example, after a save by an older Inspector) may not be cleaned up automatically.`,
  );
}

/** Test seam: forget which ledger-failure warnings have been emitted. */
export function resetNamespaceLedgerWarnings(): void {
  warnedLedgerFailures.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOwners(value: unknown): ClientCredentialOwners {
  const owners: ClientCredentialOwners = new Map();
  if (!isRecord(value)) return owners;
  for (const [url, fields] of Object.entries(value)) {
    if (!isRecord(fields)) continue;
    const byField = new Map<string, string>();
    for (const [field, clientId] of Object.entries(fields)) {
      if (typeof clientId === "string") byField.set(field, clientId);
    }
    if (byField.size > 0) owners.set(url, byField);
  }
  return owners;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Parse a raw ledger, tolerantly: anything unrecognized reads as empty, and
 * an invalid namespace is skipped — it would otherwise reach store ids,
 * where it could forge the id delimiter (see `isValidSecretsNamespace`).
 * Keys are URLs/issuers rather than raw store ids for the same reason: ids
 * are always rebuilt here, so a tampered ledger can only ever name OAuth
 * ids, never a catalog server's or `client.json`'s.
 */
function parseLedger(raw: string | null): Ledger {
  const ledger: Ledger = new Map();
  if (raw === null) return ledger;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ledger;
  }
  const namespaces = isRecord(parsed) ? parsed.namespaces : undefined;
  if (!isRecord(namespaces)) return ledger;
  for (const [namespace, locations] of Object.entries(namespaces)) {
    if (!isValidSecretsNamespace(namespace) || !isRecord(locations)) continue;
    const byLocation = new Map<string, LedgerKeys>();
    for (const [location, keys] of Object.entries(locations)) {
      if (!isRecord(keys)) continue;
      byLocation.set(location, {
        servers: new Set(stringsOf(keys.servers)),
        idpSessions: new Set(stringsOf(keys.idpSessions)),
        owners: parseOwners(keys.owners),
        ...(isValidSecretsNamespace(keys.owedTo) && { owedTo: keys.owedTo }),
      });
    }
    if (byLocation.size > 0) ledger.set(namespace, byLocation);
  }
  return ledger;
}

function serializeLedger(ledger: Ledger): string {
  const namespaces = Object.fromEntries(
    [...ledger].map(([namespace, byLocation]) => [
      namespace,
      Object.fromEntries(
        [...byLocation].map(([location, keys]) => [
          location,
          {
            servers: [...keys.servers],
            idpSessions: [...keys.idpSessions],
            ...(keys.owners.size > 0 && {
              owners: Object.fromEntries(
                [...keys.owners].map(([url, fields]) => [
                  url,
                  Object.fromEntries(fields),
                ]),
              ),
            }),
            ...(keys.owedTo !== undefined && { owedTo: keys.owedTo }),
          },
        ]),
      ),
    ]),
  );
  return serializeStore({ namespaces });
}

async function writeLedger(
  stateFilePath: string,
  ledger: Ledger,
): Promise<void> {
  const path = namespaceLedgerPath(stateFilePath);
  if (ledger.size === 0) await deleteStoreFile(path);
  else await writeStoreFile(path, serializeLedger(ledger));
}

/**
 * Record that store entries for these keys are about to be written under
 * `namespace` in `secretStore`. Call it *before* the store writes, so a
 * crash between the two leaves an over-recorded ledger rather than an
 * unrecorded entry. Rewrites the ledger only when a key is new, so a
 * steady-state save costs one small read. `owners` is, per server, the
 * `client_id` each client credential being written belongs to (#2672);
 * a later write's owner replaces an earlier one's, as its secret does.
 */
export async function recordNamespaceKeys(
  stateFilePath: string,
  secretStore: SecretStore,
  namespace: string,
  servers: Iterable<string>,
  idpSessions: Iterable<string>,
  owners: ClientCredentialOwners = new Map(),
): Promise<void> {
  try {
    const ledger = parseLedger(
      await readStoreFile(namespaceLedgerPath(stateFilePath)),
    );
    const location = await secretStoreLocation(secretStore);
    let byLocation = ledger.get(namespace);
    if (!byLocation) {
      byLocation = new Map();
      ledger.set(namespace, byLocation);
    }
    let keys = byLocation.get(location);
    let changed = false;
    if (!keys) {
      keys = emptyKeys();
      byLocation.set(location, keys);
      changed = true;
    }
    for (const url of servers) {
      if (keys.servers.has(url)) continue;
      keys.servers.add(url);
      changed = true;
    }
    for (const issuer of idpSessions) {
      if (keys.idpSessions.has(issuer)) continue;
      keys.idpSessions.add(issuer);
      changed = true;
    }
    if (mergeOwners(keys.owners, owners)) changed = true;
    if (changed) await writeLedger(stateFilePath, ledger);
  } catch (error) {
    warnLedgerFailure("update", error);
  }
}

/**
 * Mark every record of a namespace other than `into` that lives somewhere
 * other than `secretStore`, and holds a client credential, as owed to
 * `into` (#2672): adoption's carry-over reads through this run's store
 * only, so those records were not carried into it.
 *
 * Unlike the rest of the ledger this throws, and adoption fails with it:
 * call it before the stamp commits, because an adoption that commits
 * without the mark leaves the record looking disposable, and the first
 * save on its backend would purge the only copy of its secret.
 */
export async function markUncarriedNamespaces(
  stateFilePath: string,
  secretStore: SecretStore,
  into: string,
): Promise<void> {
  const ledger = parseLedger(
    await readStoreFile(namespaceLedgerPath(stateFilePath)),
  );
  const location = await secretStoreLocation(secretStore);
  let changed = false;
  for (const [namespace, byLocation] of ledger) {
    if (namespace === into) continue;
    for (const [recorded, keys] of byLocation) {
      if (recorded === location || keys.owners.size === 0) continue;
      if (keys.owedTo === into) continue;
      keys.owedTo = into;
      changed = true;
    }
  }
  if (changed) await writeLedger(stateFilePath, ledger);
}

/**
 * The records a run in `secretStore`'s location still owes `current` a
 * carry-over from (#2672), newest first: each one's namespace and, per
 * server, the `client_id` each client credential it holds belongs to. A
 * stamped file's reads fall back to these — for those fields only, and
 * only where the file still holds a client with that `client_id` — so the
 * state a save starts from does not drop a secret the purge is about to
 * carry.
 *
 * Throws on an unreadable ledger, like the strict store reads beside it:
 * reading as empty would present an owed secret as absent, and the save
 * that follows would delete it right after the purge carried it.
 */
export async function pendingCarries(
  stateFilePath: string,
  secretStore: SecretStore,
  current: string,
): Promise<Array<{ namespace: string; owners: ClientCredentialOwners }>> {
  const ledger = parseLedger(
    await readStoreFile(namespaceLedgerPath(stateFilePath)),
  );
  const location = await secretStoreLocation(secretStore);
  const carries: Array<{ namespace: string; owners: ClientCredentialOwners }> =
    [];
  for (const [namespace, byLocation] of ledger) {
    const owed = coveredLocations(location, byLocation).some(
      ({ keys }) => keys.owedTo === current,
    );
    if (owed) {
      carries.push({
        namespace,
        owners: effectiveOwners(location, byLocation),
      });
    }
  }
  return carries.reverse();
}

/**
 * Copy what an owed record holds into `current` before it is purged
 * (#2672): each client credential it recorded, into the same server's id
 * under `current`, only where `current` holds nothing for it and the state
 * file (`now`) still holds a client with the `client_id` it belongs to.
 * Records the key and its owner under `current` first, like every other
 * write the ledger tracks. Returns whether every carry succeeded; a
 * failure leaves the record for the next locked save.
 */
async function carryOwed(
  stateFilePath: string,
  ledger: Ledger,
  location: string,
  secretStore: SecretStore,
  namespace: string,
  current: string,
  recorded: ClientCredentialOwners,
  now: ClientCredentialOwners,
): Promise<boolean> {
  let carried = true;
  for (const [url, fields] of recorded) {
    for (const [field, clientId] of fields) {
      if (now.get(url)?.get(field) !== clientId) continue;
      try {
        const from = oauthSecretServerId(url, namespace);
        const to = oauthSecretServerId(url, current);
        const value = await secretStoreGetStrict(secretStore, from, field);
        if (value === null) continue;
        if ((await secretStoreGetStrict(secretStore, to, field)) !== null) {
          continue;
        }
        let byLocation = ledger.get(current);
        if (!byLocation) {
          byLocation = new Map();
          ledger.set(current, byLocation);
        }
        const target = byLocation.get(location) ?? emptyKeys();
        byLocation.set(location, target);
        const isNew = !target.servers.has(url);
        target.servers.add(url);
        const owner = new Map([[url, new Map([[field, clientId]])]]);
        if (mergeOwners(target.owners, owner) || isNew) {
          await writeLedger(stateFilePath, ledger);
        }
        await secretStore.set(to, field, value);
      } catch (error) {
        carried = false;
        warnLedgerFailure(
          "carry over a superseded namespace recorded in",
          error,
        );
      }
    }
  }
  return carried;
}

/**
 * Every namespace the ledger records, newest first (#2630). A namespace is
 * appended when it is first recorded and JSON keeps that order, so the last
 * one recorded is the one the file most recently carried.
 *
 * This is how an unstamped file's entries reach the secrets their old
 * namespace still holds. A ≤ 2.9.x save strips the stamp but keeps the
 * entries, and reads secrets only from the legacy shared ids, which
 * adoption already emptied, so a confidential DCR client's `client_secret`
 * survives only under the stripped namespace. Reads and adoption fall back
 * to these namespaces for any field the legacy ids lack, which carries the
 * secret into the next namespace before the purge removes the old one.
 *
 * Best-effort like the rest of the ledger: an unreadable ledger warns and
 * reads as empty, which is the same outcome as not having a ledger.
 */
export async function recordedNamespaces(
  stateFilePath: string,
): Promise<string[]> {
  try {
    const ledger = parseLedger(
      await readStoreFile(namespaceLedgerPath(stateFilePath)),
    );
    return [...ledger.keys()].reverse();
  } catch (error) {
    warnLedgerFailure("read", error);
    return [];
  }
}

/**
 * Purge, from `secretStore`, every recorded namespace other than `current`
 * — the namespace the state file actually carries, or `undefined` when it
 * carries none (a stripped stamp, a file deleted by hand, a whole-file
 * removal), in which case every recorded namespace is superseded. Only the
 * keys recorded for the locations this store covers are purged (see
 * {@link coveredLocations}), and a location's record is dropped only once
 * all its ids are gone; one whose purge failed stays recorded, so the next
 * locked save or removal retries it. Records for other locations are left
 * for a run that uses them.
 *
 * A record an adoption could not read and marked as owed to `current` is
 * carried into it first, for the clients `owners` — what the state file
 * holds now — still matches (see {@link markUncarriedNamespaces}); a
 * failed carry leaves the record unpurged, for the same retry. Records are
 * visited newest first, so where two owe the same field the newer value
 * is the one carried, as a read would have seen it — and a failed carry
 * ends the pass, so an older record cannot fill the field the newer one
 * still owes it.
 *
 * Only call this under the real file lock: it deletes credentials, and an
 * unlocked caller could be racing an adopter whose namespace is recorded
 * but not yet stamped.
 */
export async function purgeSupersededNamespaces(
  stateFilePath: string,
  secretStore: SecretStore,
  current: string | undefined,
  owners: ClientCredentialOwners = new Map(),
): Promise<void> {
  let ledger: Ledger;
  let location: string;
  try {
    ledger = parseLedger(
      await readStoreFile(namespaceLedgerPath(stateFilePath)),
    );
    location = await secretStoreLocation(secretStore);
  } catch (error) {
    warnLedgerFailure("read", error);
    return;
  }
  let changed = false;
  let carryFailed = false;
  for (const [namespace, byLocation] of [...ledger].reverse()) {
    if (carryFailed) break;
    if (namespace === current) continue;
    const trusted = effectiveOwners(location, byLocation);
    for (const { location: recorded, keys } of coveredLocations(
      location,
      byLocation,
    )) {
      if (
        current !== undefined &&
        keys.owedTo === current &&
        !(await carryOwed(
          stateFilePath,
          ledger,
          location,
          secretStore,
          namespace,
          current,
          trusted,
          owners,
        ))
      ) {
        carryFailed = true;
        break;
      }
      const purges = [
        ...[...keys.servers].map(
          (url) => () => oauthSecretServerId(url, namespace),
        ),
        ...[...keys.idpSessions].map(
          (issuer) => () => oauthIdpSecretServerId(issuer, namespace),
        ),
      ];
      let purged = true;
      // Per-id catch, like adoption's legacy purge: one failure must not
      // abandon the remaining ids. The id is built inside it too — a key
      // with an unpaired surrogate makes `encodeURIComponent` throw.
      for (const idOf of purges) {
        try {
          await secretStore.deleteAllForServer(idOf());
        } catch (error) {
          purged = false;
          warnLedgerFailure("purge an orphaned namespace recorded in", error);
        }
      }
      if (!purged || recorded !== location) continue;
      byLocation.delete(recorded);
      // A file's entries may also have been copied into the keychain by a
      // hand-off this ledger never saw; keep tracking them there — owners
      // and any carry still owed included, since a copy absorbed before
      // this run is one this run's carry could not find (#2672).
      if (recorded.startsWith(FILE_LOCATION_PREFIX)) {
        const keyring = byLocation.get(KEYRING_LOCATION) ?? emptyKeys();
        // Before the servers merge, which would make every one look like
        // the keychain's own.
        keyring.owners = foldOwners(keyring, keys.owners);
        for (const url of keys.servers) keyring.servers.add(url);
        for (const issuer of keys.idpSessions) keyring.idpSessions.add(issuer);
        keyring.owedTo ??= keys.owedTo;
        byLocation.set(KEYRING_LOCATION, keyring);
      }
      changed = true;
    }
    if (byLocation.size === 0) ledger.delete(namespace);
  }
  if (!changed) return;
  try {
    await writeLedger(stateFilePath, ledger);
  } catch (error) {
    warnLedgerFailure("update", error);
  }
}
