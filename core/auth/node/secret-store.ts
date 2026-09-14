/**
 * Per-server secret storage backed by the OS keychain.
 *
 * Service name `mcp-inspector`; account `${serverId}:${field}`. Fields used
 * by the current code: `oauth-client-secret` and `env:${KEY}` (one per
 * stdio env variable). Keeping the account namespaced by `serverId` lets
 * us drop every entry for a server in one sweep when DELETE
 * /api/servers/:id runs, and lets `findCredentials(SERVICE)` enumerate
 * everything we own for migration / debugging.
 *
 * Node-only — `@napi-rs/keyring` uses native bindings (Keychain Services
 * on macOS, Credential Manager on Windows, libsecret on Linux). The
 * browser side never imports this; it gets values rehydrated into the
 * `/api/servers` response by the Hono handler.
 */

const SERVICE_NAME = "mcp-inspector";

/**
 * `@napi-rs/keyring` ships one prebuilt binary per platform triple, and
 * loading the package *throws* on a platform it has no binary for —
 * Android / Termux is the reported case (#1905), where the import fails
 * with "Cannot find native binding" / "Cannot find module
 * '@napi-rs/keyring-android-arm64'".
 *
 * A static top-level import made that a startup crash: the module never
 * evaluated, so the Inspector exited before any of the
 * keychain-unavailable handling below could run. Loading it lazily, and
 * caching the *outcome* rather than only the module, folds an
 * unsupported platform into the same degradation contract as an
 * unreachable keychain (see `KeyringSecretStore`) — the store is simply
 * unavailable, and callers see it through the documented behavior
 * instead of a crash.
 *
 * The failure is cached alongside the success so a box without a binary
 * doesn't re-attempt (and re-throw) the resolution on every secret
 * operation, and so `set` can name the underlying cause in its
 * `KeychainUnavailableError`.
 *
 * The cache is process-lifetime by design — there is no reset seam, since
 * a platform does not grow a native binary mid-run. Tests reach the
 * unloadable path through `vi.resetModules()` + `vi.doMock`, which gives
 * them a fresh module (and so a fresh cache) instead.
 *
 * A resolved import is also **shape-checked** before being accepted. The
 * package is CJS, so the named exports we rely on come from interop, and
 * a resolution that stopped yielding them (a default-only export in a
 * future version, a bundler changing interop, a platform where the
 * named-export detection fails) would land as `undefined`, making
 * `new mod.AsyncEntry(...)` throw `TypeError: not a constructor` from
 * inside the very `try` that implements graceful degradation.
 *
 * Be precise about what this buys, because it is narrower than it looks:
 * it does **not** stop a bad shape from emptying the secret list. `get`
 * returns `null` either way — that is its read-tolerance contract, and
 * the `TypeError` lands in the same `catch` that a dead keychain does.
 * What the check changes is *diagnosis*. Without it the only signal is
 * `set` reporting "keyring.mod.AsyncEntry is not a constructor", an
 * internal-looking message that reads like an Inspector bug; with it,
 * `set` names the actual problem once, at the load boundary, in the same
 * actionable 503 as every other flavor of unavailability. Detecting the
 * silent-empty-list case itself would take a real round-trip against the
 * unmocked package, which nothing in the suite does today.
 */
type KeyringModule = typeof import("@napi-rs/keyring");
type KeyringLoad =
  | { ok: true; mod: KeyringModule }
  | { ok: false; err: unknown };

let keyringLoad: Promise<KeyringLoad> | undefined;

/**
 * Accept a resolved import only if it carries the two members we call.
 *
 * The member *access* is inside the `try` because reading a missing
 * export is not always the harmless `undefined` a plain ESM namespace
 * gives: a Proxy-based namespace can throw on an unknown key (vitest's
 * module mocks do exactly that). Either way the answer is the same —
 * unavailable — and returning it rather than throwing is what keeps the
 * cached promise from ever rejecting.
 */
/**
 * Marks the shape-check failure so `KeychainUnavailableError` can give
 * advice that fits it. A distinct type rather than a string match on the
 * message: this is our own error, so there is no reason to re-parse text
 * we just wrote (the native-binding branch matches on a string only
 * because that message comes from someone else's loader).
 */
export class KeyringModuleShapeError extends Error {
  constructor(detail: string, options?: { cause?: unknown }) {
    super(`@napi-rs/keyring loaded but ${detail}`, options);
    this.name = "KeyringModuleShapeError";
  }
}

const checkKeyringShape = (mod: KeyringModule): KeyringLoad => {
  try {
    if (
      typeof mod.AsyncEntry === "function" &&
      typeof mod.findCredentialsAsync === "function"
    ) {
      return { ok: true, mod };
    }
    return {
      ok: false,
      err: new KeyringModuleShapeError(
        "did not expose AsyncEntry / findCredentialsAsync",
      ),
    };
  } catch (err) {
    // Both ways of failing the shape check are the same problem — the
    // module is not the API we expect — so both carry the type that
    // earns the packaging hint. Returning the raw error here instead
    // would drop it back to the libsecret advice, which is what this
    // whole branch exists to avoid.
    return {
      ok: false,
      err: new KeyringModuleShapeError(
        `its exports could not be read: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      ),
    };
  }
};

const loadKeyring = (): Promise<KeyringLoad> => {
  keyringLoad ??= import("@napi-rs/keyring").then(
    checkKeyringShape,
    (err: unknown): KeyringLoad => ({ ok: false, err }),
  );
  return keyringLoad;
};

export {
  SECRET_FIELD_OAUTH_CLIENT_SECRET,
  SECRET_FIELD_IDP_CLIENT_SECRET,
  envSecretField,
} from "../secret-fields.js";

/** Parse a stored account key back into its server id and field. */
export function parseAccount(
  account: string,
): { serverId: string; field: string } | null {
  const idx = account.indexOf(":");
  if (idx <= 0 || idx === account.length - 1) return null;
  return {
    serverId: account.slice(0, idx),
    field: account.slice(idx + 1),
  };
}

const buildAccount = (serverId: string, field: string): string =>
  `${serverId}:${field}`;

/**
 * Base type for "the active secret store cannot do this right now".
 *
 * Every store implementation hard-fails on `set` and only on `set` (see
 * the {@link SecretStore} contract), and the API routes translate that
 * one condition into a 503. Before #1950 there was only one store, so the
 * routes could match on `KeychainUnavailableError` directly; now that a
 * file-backed store can fail for entirely different reasons (an
 * unreadable file, a changed passphrase) they match on this base instead,
 * and a future store gets the same treatment by extending it rather than
 * by every route learning its name.
 *
 * The message is the user-facing text — these are surfaced verbatim in
 * the 503 body — so subclasses write advice, not diagnostics.
 */
export class SecretStoreUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecretStoreUnavailableError";
  }
}

/**
 * Thrown when the OS keychain is unavailable. Surfaced as a 503 by the
 * API handlers so the UI can show an actionable error rather than a
 * generic 500 — and "actionable" is the point: the causes need
 * *different* fixes, so the message carries a hint chosen per cause
 * (see `hintFor`). Three realistic ones:
 *
 * - **The keychain itself is missing** — Linux without libsecret /
 *   gnome-keyring. Install it.
 * - **`@napi-rs/keyring` won't load** — no platform binary for this
 *   triple (Android/Termux, #1905) or npm's optional-deps bug dropping
 *   it on a supported one (npm/cli#4828). Reinstall / clear the npx
 *   cache; installing a keyring daemon would not help.
 * - **It loads but exposes the wrong API** — a version or packaging
 *   mismatch (`KeyringModuleShapeError`). Also not a daemon problem.
 */
export class KeychainUnavailableError extends SecretStoreUnavailableError {
  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(
      `OS keychain is not available. ${hintFor(cause, message)} Underlying error: ${message}`,
    );
    this.name = "KeychainUnavailableError";
  }
}

/**
 * The remediation that fits the cause. Wrong advice is worse than none —
 * telling someone on Windows to install libsecret sends them down a path
 * that cannot work — so every cause that has its own fix gets its own
 * branch, and the libsecret line is the fallback rather than the default.
 */
const hintFor = (cause: unknown, message: string): string => {
  // Our own error, so match on the type rather than re-parsing text we wrote.
  if (cause instanceof KeyringModuleShapeError) {
    return `The @napi-rs/keyring package loaded but does not expose the API this build expects — most likely a version or packaging mismatch; reinstall the Inspector, and report this if it persists.`;
  }
  // This phrasing comes from the napi-rs loader, not from us: it is what
  // the package throws when the platform binary is missing.
  if (message.includes("Cannot find native binding")) {
    return `The @napi-rs/keyring platform package for this OS is missing or unavailable — reinstall the Inspector (for npx, clear the npx cache under your npm cache directory first).`;
  }
  return `On Linux, install libsecret / gnome-keyring.`;
};

/**
 * Probe whether the OS keychain is actually usable, rather than merely
 * importable.
 *
 * This is the input to the automatic-fallback policy in
 * `secret-store-selection.ts`, and it deliberately does more than
 * {@link loadKeyring}: on the container that motivated #1848 the package
 * imports and shape-checks perfectly well, and the failure only appears
 * when `AsyncEntry::new` tries to reach a Secret Service that isn't
 * there. So the probe constructs an entry and performs a real read.
 *
 * A **read** and not a write, on purpose. A write would be the stronger
 * signal — a keychain can in principle be readable and not writable — but
 * it means depositing a value in the user's login keyring at every
 * startup, for a store they may never use, that we would then have to
 * clean up (and would leave behind if the process died between the two
 * calls). Writing into someone's keychain uninvited to answer a question
 * about our own configuration is not a trade worth making; a write that
 * fails after a passing probe still surfaces as the documented 503.
 *
 * Never throws — the whole point is to answer a question, and a probe
 * that could fail its caller would just move the crash it exists to
 * prevent.
 */
export async function probeKeyringAvailable(): Promise<
  { available: true } | { available: false; detail: string }
> {
  const keyring = await loadKeyring();
  if (!keyring.ok) {
    const err = keyring.err;
    return {
      available: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    const entry = new keyring.mod.AsyncEntry(SERVICE_NAME, PROBE_ACCOUNT);
    await entry.getPassword();
    return { available: true };
  } catch (err) {
    return {
      available: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Account used by {@link probeKeyringAvailable}. Namespaced under a server
 * id that cannot collide with a real one (`:` is the account separator, so
 * a real id never contains one) and never written — it only ever appears
 * as the argument to a lookup that is expected to miss.
 */
const PROBE_ACCOUNT = "__inspector:probe";

/**
 * Storage interface for the per-server secrets we lift off
 * `~/.mcp-inspector/mcp.json`.
 *
 * Three implementations, selected per run by
 * `secret-store-selection.ts` (#1950) and described to the user by the
 * `SecretStorageInfo` it returns:
 *
 * - `KeyringSecretStore` — the OS keychain, and the default wherever one
 *   is reachable.
 * - `FileSecretStore` — `~/.mcp-inspector/secrets.json`, `0600`,
 *   encrypted when `MCP_INSPECTOR_SECRET_KEY` is set. The fallback on a
 *   host with no keychain, and on a container with a mounted volume.
 * - `InMemorySecretStore` — the session-scoped store. Used by the test
 *   suite (so CI needs no libsecret), and as the container fallback when
 *   nothing durable is mounted, where it is the honest choice rather than
 *   the degraded one: a file in the writable layer promises persistence
 *   the next `docker run` will not honor.
 *
 * All three share one availability contract, which is what lets callers
 * stay ignorant of which they got: `get` is tolerant (`null` on any
 * failure), `delete` no-ops, and `set` is the only operation that
 * hard-fails — throwing a {@link SecretStoreUnavailableError} the API
 * routes turn into a 503 — because it is the only one where a value would
 * be lost.
 */
/** One server's worth of a bulk read: which fields, for which server id. */
export interface SecretBulkRequest {
  serverId: string;
  fields: string[];
}

export interface SecretStore {
  /**
   * Do values written here outlive the process?
   *
   * Optional, and **absent means durable** — every store that predates
   * #1950 is, and a custom one is far more likely to be backed by
   * something than by RAM.
   *
   * It exists because the *migrations* need it. Both of them (mcp.json in
   * `server.ts`, client.json in `client/node-persistence.ts`) lift a
   * plaintext secret off disk, write it to this store, and then strip it
   * from the file — a safe trade only while "written to the store" is at
   * least as durable as "left on disk". `InMemorySecretStore` used to be
   * a test double only, so that held by construction; making it a
   * production fallback broke it, and a plain `GET /api/servers` on an
   * unmounted container would have moved a user's existing secrets into
   * RAM and lost them at exit.
   */
  isDurable?(): Promise<boolean>;
  get(serverId: string, field: string): Promise<string | null>;
  /**
   * Like {@link get}, but **throws** when the store cannot be read instead
   * of answering `null`.
   *
   * `get` is deliberately tolerant — an unreachable keychain and an absent
   * entry are the same answer to a caller that just wants to render a form.
   * That tolerance is wrong for exactly one caller: a migration that treats
   * `null` as proof of absence and then *writes*. A transient read failure
   * would look like "nothing there", and the write would overwrite a newer
   * keychain value with an older file copy — silently inverting the
   * keychain-wins rule the migration exists to honor.
   *
   * Optional, so existing implementations (and test doubles) keep
   * compiling; {@link secretStoreGetStrict} falls back to `get` when it is
   * absent, which is correct for stores whose reads cannot fail.
   */
  getStrict?(serverId: string, field: string): Promise<string | null>;
  /**
   * Read many fields, across **many servers**, in a single pass.
   *
   * Optional, and purely a performance seam: {@link secretStoreGetMany}
   * falls back to a parallel `get` per field, which is what the keychain
   * wants anyway (independent native round-trips).
   *
   * It exists for `FileSecretStore`, where the shape is inverted — every
   * `get` reads and decrypts the *whole* file, so each call costs a scrypt
   * derivation, serialized behind the store's own queue.
   *
   * **Cross-server, and that is the whole point.** A per-server version of
   * this shipped first and did not fix the case it was written for: both
   * rehydration callers iterate servers, so a catalog of 20 servers holding
   * one secret each still paid 20 serialized derivations — the same stall,
   * reached one server at a time instead of one field at a time. The unit
   * that matters is "everything this rehydration needs", so that is the
   * unit the seam takes.
   */
  getMany?(
    requests: SecretBulkRequest[],
  ): Promise<Record<string, Record<string, string>>>;
  set(serverId: string, field: string, value: string): Promise<void>;
  /**
   * Write several of one server's fields in a single pass.
   *
   * The write-side twin of {@link getMany}, and the same shape of problem:
   * `FileSecretStore.set` costs a whole-file read, decrypt, encrypt, write
   * and verifying read *per call*, all serialized. A settings save resends
   * the server's full `env` map even when the user edited something
   * unrelated, so an entry with N secret fields paid roughly `3N` scrypt
   * derivations on every debounced save — a stall that grows with the
   * environment rather than with the edit.
   *
   * Optional: {@link secretStoreSetMany} falls back to parallel `set` calls,
   * which is what the keychain wants (independent native round-trips).
   */
  setMany?(serverId: string, values: Record<string, string>): Promise<void>;
  /** No-op if no entry exists. */
  delete(serverId: string, field: string): Promise<void>;
  /** Remove every secret stored for this server id (called on DELETE /api/servers/:id). */
  deleteAllForServer(serverId: string): Promise<void>;
}

/**
 * Default implementation. Each operation constructs a fresh `AsyncEntry`;
 * the native side is cheap and the alternative (caching entries by
 * (serverId, field)) just trades native-handle bookkeeping for an
 * allocation that's measured in microseconds. `getPassword` returns
 * `undefined` for a missing entry — we normalize to `null` so callers
 * can use `=== null` rather than truthiness (an empty-string secret is
 * a real value and must round-trip).
 *
 * **Availability behavior.** When the keychain is unavailable, `set` is
 * the only operation that throws `KeychainUnavailableError` — that's
 * the moment where data would actually be lost. `get` returns `null`
 * (as if no entry existed) and the destructive operations silently
 * no-op (there's nothing to delete anyway). This keeps non-secret flows
 * working on a stock CI runner / minimal Linux box / unsupported
 * platform; the user only hits a hard error when they actually try to
 * save a secret.
 *
 * "Unavailable" covers four distinct failures, all funneled into that
 * one contract — the contract is only as good as its narrowest funnel,
 * and each of these escaped it at some point:
 *
 * 1. **The package won't load at all** — no prebuilt binary for this
 *    platform (Android / Termux). A static top-level import made this a
 *    startup crash before any handling ran (#1905); `loadKeyring()`
 *    above defers and caches it instead.
 * 2. **The package loads but exposes the wrong shape** — the named
 *    exports arrive via CJS interop, so a resolution that stopped
 *    yielding them would hand us `undefined` and fail as a `TypeError`
 *    swallowed by the degradation path. `loadKeyring()` shape-checks up
 *    front so `set` can name that cause instead of surfacing an
 *    "is not a constructor" message (see the note there — the check
 *    improves the diagnosis, it does not change what `get` returns).
 * 3. **`AsyncEntry::new` throws** — it performs the platform-store setup
 *    (on Linux, the Secret Service connect with a keyutils fallback) and
 *    throws when no backend is reachable. Construction is therefore
 *    deliberately **inside** each method's `try`; outside it, the raw
 *    error escaped and 500'd every `GET /api/servers` before any secret
 *    was involved (#1848).
 * 4. **The operation itself throws** — the original case, and the only
 *    one the first version of this contract actually handled.
 */
export class KeyringSecretStore implements SecretStore {
  /**
   * The intolerant read. Same lookup as {@link get}, minus the catch — a
   * keychain that cannot answer must not be reported as an empty one to a
   * caller that is about to write based on the answer.
   */
  async getStrict(serverId: string, field: string): Promise<string | null> {
    try {
      const keyring = await loadKeyring();
      if (!keyring.ok) throw new KeychainUnavailableError(keyring.err);
      const entry = new keyring.mod.AsyncEntry(
        SERVICE_NAME,
        buildAccount(serverId, field),
      );
      return (await entry.getPassword()) ?? null;
    } catch (err) {
      // "Strict" means the caller learns the read failed — not that it
      // learns in a form it cannot handle. Both plaintext migrations keep
      // their source file only when they catch `SecretStoreUnavailableError`;
      // a raw binding error escaping here sails past that and turns
      // `GET /api/servers` (or client-config loading) into a 500 instead of
      // an abandoned migration. Same wrapping `set` already does, for the
      // same reason.
      if (err instanceof KeychainUnavailableError) throw err;
      throw new KeychainUnavailableError(err);
    }
  }

  async get(serverId: string, field: string): Promise<string | null> {
    try {
      const keyring = await loadKeyring();
      if (!keyring.ok) return null;
      const entry = new keyring.mod.AsyncEntry(
        SERVICE_NAME,
        buildAccount(serverId, field),
      );
      const v = await entry.getPassword();
      return v ?? null;
    } catch {
      // Tolerate keychain unavailability on reads: there's no value to
      // surface either way. Hard-failing here would break GET flows
      // that don't touch any secret material (most of the test suite,
      // and most user sessions on a Linux box without libsecret).
      return null;
    }
  }

  async set(serverId: string, field: string, value: string): Promise<void> {
    try {
      const keyring = await loadKeyring();
      // An unloadable package is as fatal to a write as an unreachable
      // keychain, and for the same reason — the value would vanish.
      if (!keyring.ok) throw new KeychainUnavailableError(keyring.err);
      const entry = new keyring.mod.AsyncEntry(
        SERVICE_NAME,
        buildAccount(serverId, field),
      );
      await entry.setPassword(value);
    } catch (err) {
      // Already the typed error when the module failed to load — don't
      // double-wrap it (that would bury the underlying cause one level
      // deeper in the message).
      if (err instanceof KeychainUnavailableError) throw err;
      // The only operation that hard-fails — if we can't persist the
      // secret, the user needs to know now rather than discover later
      // that their value disappeared. Routes translate this to a 503.
      throw new KeychainUnavailableError(err);
    }
  }

  async delete(serverId: string, field: string): Promise<void> {
    try {
      const keyring = await loadKeyring();
      if (!keyring.ok) return;
      const entry = new keyring.mod.AsyncEntry(
        SERVICE_NAME,
        buildAccount(serverId, field),
      );
      await entry.deleteCredential();
    } catch {
      // Every reason for a throw collapses to the same desired outcome
      // ("the entry isn't there anymore"): `deleteCredential` raises
      // NoEntry for a missing credential, and both the constructor and
      // the native binding raise a runtime error when the keychain
      // itself is unavailable. We treat all of them as success — there's
      // no value to lose either way, and `set` is the operation that
      // hard-fails when the keychain is actually down.
    }
  }

  async deleteAllForServer(serverId: string): Promise<void> {
    let creds: Array<{ account: string; password: string }>;
    try {
      const keyring = await loadKeyring();
      if (!keyring.ok) return;
      creds = await keyring.mod.findCredentialsAsync(SERVICE_NAME);
    } catch {
      // Same reasoning as `delete`: nothing was written, nothing to sweep.
      return;
    }
    const prefix = `${serverId}:`;
    for (const c of creds) {
      if (!c.account.startsWith(prefix)) continue;
      const parsed = parseAccount(c.account);
      if (!parsed || parsed.serverId !== serverId) continue;
      await this.delete(serverId, parsed.field);
    }
  }
}

/**
 * Test double — substituted via the `secretStore` option on the remote
 * server factory. Mirrors the keyring contract exactly so swapping it
 * in/out doesn't change behavior beyond persistence.
 */
/**
 * Is `store` durable? Absent `isDurable` means yes — see the interface.
 *
 * A free function rather than a required method so the existing test
 * doubles (and any third-party implementation) keep compiling, while the
 * one store that is *not* durable has to say so explicitly. Defaulting the
 * other way would make every double silently non-durable and quietly
 * disable the migrations they exist to exercise.
 */
/**
 * Read `store` intolerantly: throw rather than answer `null` when the store
 * itself cannot be read.
 *
 * Falls back to `get` only for stores that genuinely cannot fail that way —
 * in practice `InMemorySecretStore`, whose reads are a `Map` lookup. It is
 * **not** a safe fallback for the file store: `FileSecretStore.get`
 * deliberately converts filesystem, format and key failures to `null`, which
 * is exactly the masquerade this helper exists to prevent, and is why that
 * store implements `getStrict` itself. The fallback stays because the seam is
 * optional and third-party/test doubles must keep compiling — not because
 * `get` is equivalent for anything that can fail.
 */
export async function secretStoreGetStrict(
  store: SecretStore,
  serverId: string,
  field: string,
): Promise<string | null> {
  return store.getStrict
    ? store.getStrict(serverId, field)
    : store.get(serverId, field);
}

/**
 * Read many servers' fields, using the store's bulk path when it has one.
 *
 * Returns a map keyed by server id, holding only the fields that are
 * present — matching the callers, which merge each server's result into its
 * stored config. The fallback issues every `get` in parallel, which is right
 * for a keychain (independent native round-trips) and harmless for the
 * in-memory store.
 */
export async function secretStoreGetMany(
  store: SecretStore,
  requests: SecretBulkRequest[],
): Promise<Record<string, Record<string, string>>> {
  if (store.getMany) return store.getMany(requests);
  const out: Record<string, Record<string, string>> = {};
  await Promise.all(
    requests.map(async ({ serverId, fields }) => {
      const entries = await Promise.all(
        fields.map(
          async (field) => [field, await store.get(serverId, field)] as const,
        ),
      );
      const found: Record<string, string> = {};
      for (const [field, value] of entries) {
        if (value !== null) found[field] = value;
      }
      out[serverId] = found;
    }),
  );
  return out;
}

/**
 * Write several of one server's fields, using the store's bulk path when it
 * has one. Falls back to parallel `set`s.
 *
 * The fallback keeps `set`'s contract: `Promise.all` surfaces the first
 * rejection, which is what the routes translate into a 503.
 */
export async function secretStoreSetMany(
  store: SecretStore,
  serverId: string,
  values: Record<string, string>,
): Promise<void> {
  if (store.setMany) return store.setMany(serverId, values);
  await Promise.all(
    Object.entries(values).map(([field, value]) =>
      store.set(serverId, field, value),
    ),
  );
}

export async function secretStoreIsDurable(
  store: SecretStore,
): Promise<boolean> {
  return store.isDurable ? store.isDurable() : true;
}

export class InMemorySecretStore implements SecretStore {
  private readonly map = new Map<string, string>();

  async get(serverId: string, field: string): Promise<string | null> {
    return this.map.get(buildAccount(serverId, field)) ?? null;
  }

  async set(serverId: string, field: string, value: string): Promise<void> {
    this.map.set(buildAccount(serverId, field), value);
  }

  async delete(serverId: string, field: string): Promise<void> {
    this.map.delete(buildAccount(serverId, field));
  }

  async deleteAllForServer(serverId: string): Promise<void> {
    const prefix = `${serverId}:`;
    for (const key of [...this.map.keys()]) {
      if (key.startsWith(prefix)) this.map.delete(key);
    }
  }
}

/**
 * The in-memory store as a **production** choice — the fallback for a
 * container with no keychain and nothing durable mounted (#1950).
 *
 * Behaviorally identical to {@link InMemorySecretStore}; it exists to
 * answer `isDurable()` with `false`, and that one bit is load-bearing.
 * Both migrations (mcp.json, client.json) lift a plaintext secret off
 * disk, write it to the store, and then delete it from the file — safe
 * only while the store outlives the process. Against a session-scoped
 * store that trade destroys the secret, and it runs on an ordinary read,
 * so merely opening the app would do it.
 *
 * Kept as a separate class rather than a flag on the base so the test
 * suite's many `new InMemorySecretStore()` doubles keep standing in for a
 * *working keychain*, which is what they are there to be. Only the code
 * that deliberately chooses RAM in production says so.
 */
export class SessionSecretStore extends InMemorySecretStore {
  async isDurable(): Promise<boolean> {
    return false;
  }
}
