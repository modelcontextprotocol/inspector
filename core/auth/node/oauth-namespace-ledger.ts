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
 * Everything here is best-effort and never throws: the ledger is a cleanup
 * aid, not part of the credential path, so a failure warns once and the
 * save or removal it rides on carries on. Purging deletes credentials, so
 * the callers in `oauth-persist-file.ts` run it only under the real file
 * lock — an unlocked purge could delete a concurrent adopter's live
 * entries.
 */

import {
  deleteStoreFile,
  readStoreFile,
  writeStoreFile,
} from "../../storage/store-io.js";
import { serializeStore } from "../../storage/store-serialize.js";
import type { SecretStore } from "./secret-store.js";
import {
  isValidSecretsNamespace,
  oauthIdpSecretServerId,
  oauthSecretServerId,
} from "./oauth-secrets.js";

/** The ledger's path, derived from the state file it belongs to. */
export const namespaceLedgerPath = (stateFilePath: string): string =>
  `${stateFilePath}.namespaces.json`;

/** The keys one namespace has had store entries written under. */
interface LedgerKeys {
  servers: Set<string>;
  idpSessions: Set<string>;
}

/** Namespace → its keys. Namespaces are validated, so no prototype keys. */
type Ledger = Map<string, LedgerKeys>;

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
  const namespaces =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { namespaces?: unknown }).namespaces
      : undefined;
  if (typeof namespaces !== "object" || namespaces === null) return ledger;
  for (const [namespace, entry] of Object.entries(namespaces)) {
    if (!isValidSecretsNamespace(namespace)) continue;
    const keys =
      typeof entry === "object" && entry !== null
        ? (entry as { servers?: unknown; idpSessions?: unknown })
        : {};
    ledger.set(namespace, {
      servers: new Set(stringsOf(keys.servers)),
      idpSessions: new Set(stringsOf(keys.idpSessions)),
    });
  }
  return ledger;
}

function serializeLedger(ledger: Ledger): string {
  const namespaces: Record<
    string,
    { servers: string[]; idpSessions: string[] }
  > = {};
  for (const [namespace, keys] of ledger) {
    namespaces[namespace] = {
      servers: [...keys.servers],
      idpSessions: [...keys.idpSessions],
    };
  }
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
 * `namespace`. Call it *before* the store writes, so a crash between the
 * two leaves an over-recorded ledger rather than an unrecorded entry.
 * Rewrites the ledger only when a key is new, so a steady-state save costs
 * one small read.
 */
export async function recordNamespaceKeys(
  stateFilePath: string,
  namespace: string,
  servers: Iterable<string>,
  idpSessions: Iterable<string>,
): Promise<void> {
  try {
    const ledger = parseLedger(
      await readStoreFile(namespaceLedgerPath(stateFilePath)),
    );
    let keys = ledger.get(namespace);
    let changed = false;
    if (!keys) {
      keys = { servers: new Set(), idpSessions: new Set() };
      ledger.set(namespace, keys);
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
 * Purge every recorded namespace other than `current` — the namespace the
 * state file actually carries, or `undefined` when it carries none (a
 * stripped stamp, a file deleted by hand, a whole-file removal), in which
 * case every recorded namespace is superseded. A namespace is dropped from
 * the ledger only once all its ids are purged; one whose purge failed stays
 * recorded, so the next adoption or removal retries it.
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
  let changed = false;
  for (const [namespace, keys] of ledger) {
    if (namespace === current) continue;
    const ids = [
      ...[...keys.servers].map((url) => oauthSecretServerId(url, namespace)),
      ...[...keys.idpSessions].map((issuer) =>
        oauthIdpSecretServerId(issuer, namespace),
      ),
    ];
    let purged = true;
    // Per-id catch, like adoption's legacy purge: one failure must not
    // abandon the remaining ids.
    for (const id of ids) {
      try {
        await secretStore.deleteAllForServer(id);
      } catch (error) {
        purged = false;
        warnLedgerFailure("purge an orphaned namespace recorded in", error);
      }
    }
    if (purged) {
      ledger.delete(namespace);
      changed = true;
    }
  }
  if (!changed) return;
  try {
    await writeLedger(stateFilePath, ledger);
  } catch (error) {
    warnLedgerFailure("update", error);
  }
}
