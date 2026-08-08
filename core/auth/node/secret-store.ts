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
      err: new Error(
        "@napi-rs/keyring loaded but did not expose AsyncEntry / findCredentialsAsync",
      ),
    };
  } catch (err) {
    return { ok: false, err };
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
 * Thrown when the OS keychain is unavailable. Two realistic causes, and
 * the advice for them is different: Linux without libsecret /
 * gnome-keyring installed (the keychain is missing), and
 * `@napi-rs/keyring` failing to load at all (the *package* is missing a
 * binary for this platform triple — an unsupported OS like
 * Android/Termux, #1905, or npm's optional-deps bug dropping the
 * platform package on a supported one, npm/cli#4828). Surfaced as a 503
 * by the API handlers so the UI can show an actionable error rather
 * than a generic 500.
 */
export class KeychainUnavailableError extends Error {
  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // The napi-rs loader's throw for a missing platform binary starts
    // with this phrase — steer those users to a reinstall rather than
    // the (irrelevant) Linux keyring-daemon advice.
    const hint = message.includes("Cannot find native binding")
      ? `The @napi-rs/keyring platform package for this OS is missing or unavailable — reinstall the Inspector (for npx, clear the npx cache under your npm cache directory first).`
      : `On Linux, install libsecret / gnome-keyring.`;
    super(`OS keychain is not available. ${hint} Underlying error: ${message}`);
    this.name = "KeychainUnavailableError";
  }
}

/**
 * Storage interface for the per-server secrets we lift off
 * `~/.mcp-inspector/mcp.json`. Implemented by `KeyringSecretStore` (the
 * production impl) and `InMemorySecretStore` (used in tests so the suite
 * doesn't require libsecret in CI).
 */
export interface SecretStore {
  get(serverId: string, field: string): Promise<string | null>;
  set(serverId: string, field: string, value: string): Promise<void>;
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
