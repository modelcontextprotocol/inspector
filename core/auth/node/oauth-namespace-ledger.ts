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
 * until one of those comes along.
 *
 * Everything here is best-effort and never throws: the ledger is a cleanup
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
import { KeyringSecretStore, type SecretStore } from "./secret-store.js";
import { FileSecretStore } from "./file-secret-store.js";
import {
  isValidSecretsNamespace,
  oauthIdpSecretServerId,
  oauthSecretServerId,
} from "./oauth-secrets.js";

/** The ledger's path, derived from the state file it belongs to. */
export const namespaceLedgerPath = (stateFilePath: string): string =>
  `${stateFilePath}.namespaces.json`;

/**
 * Where a store's entries live, as a stable string another process can
 * compare: the OS keychain, one particular `secrets.json`, or RAM (the
 * test doubles and the session-scoped container fallback — entries there
 * die with the process, so purging them from any memory store is moot).
 */
export function secretStoreLocation(store: SecretStore): string {
  if (store instanceof KeyringSecretStore) return "keyring";
  if (store instanceof FileSecretStore)
    return `file:${resolve(store.filePath)}`;
  return "memory";
}

/** The keys one namespace has had store entries written under. */
interface LedgerKeys {
  servers: Set<string>;
  idpSessions: Set<string>;
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
          { servers: [...keys.servers], idpSessions: [...keys.idpSessions] },
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
 * steady-state save costs one small read.
 */
export async function recordNamespaceKeys(
  stateFilePath: string,
  secretStore: SecretStore,
  namespace: string,
  servers: Iterable<string>,
  idpSessions: Iterable<string>,
): Promise<void> {
  try {
    const ledger = parseLedger(
      await readStoreFile(namespaceLedgerPath(stateFilePath)),
    );
    const location = secretStoreLocation(secretStore);
    let byLocation = ledger.get(namespace);
    if (!byLocation) {
      byLocation = new Map();
      ledger.set(namespace, byLocation);
    }
    let keys = byLocation.get(location);
    let changed = false;
    if (!keys) {
      keys = { servers: new Set(), idpSessions: new Set() };
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
    if (changed) await writeLedger(stateFilePath, ledger);
  } catch (error) {
    warnLedgerFailure("update", error);
  }
}

/**
 * Purge, from `secretStore`, every recorded namespace other than `current`
 * — the namespace the state file actually carries, or `undefined` when it
 * carries none (a stripped stamp, a file deleted by hand, a whole-file
 * removal), in which case every recorded namespace is superseded. Only the
 * keys recorded for this store's location are purged, and a location's
 * record is dropped only once all its ids are gone; one whose purge failed
 * stays recorded, so the next locked save or removal retries it. Records
 * for other locations are left for a run that uses them.
 *
 * Only call this under the real file lock: it deletes credentials, and an
 * unlocked caller could be racing an adopter whose namespace is recorded
 * but not yet stamped.
 */
export async function purgeSupersededNamespaces(
  stateFilePath: string,
  secretStore: SecretStore,
  current: string | undefined,
): Promise<void> {
  let ledger: Ledger;
  try {
    ledger = parseLedger(
      await readStoreFile(namespaceLedgerPath(stateFilePath)),
    );
  } catch (error) {
    warnLedgerFailure("read", error);
    return;
  }
  const location = secretStoreLocation(secretStore);
  let changed = false;
  for (const [namespace, byLocation] of ledger) {
    if (namespace === current) continue;
    const keys = byLocation.get(location);
    if (!keys) continue;
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
    // abandon the remaining ids. The id is built inside it too — a key with
    // an unpaired surrogate makes `encodeURIComponent` throw.
    for (const idOf of purges) {
      try {
        await secretStore.deleteAllForServer(idOf());
      } catch (error) {
        purged = false;
        warnLedgerFailure("purge an orphaned namespace recorded in", error);
      }
    }
    if (!purged) continue;
    byLocation.delete(location);
    if (byLocation.size === 0) ledger.delete(namespace);
    changed = true;
  }
  if (!changed) return;
  try {
    await writeLedger(stateFilePath, ledger);
  } catch (error) {
    warnLedgerFailure("update", error);
  }
}
