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

type KeyringModule = typeof import("@napi-rs/keyring");

/**
 * `@napi-rs/keyring` is loaded lazily because its top-level `require`
 * throws when the platform binary package (an npm optionalDependency,
 * e.g. `@napi-rs/keyring-win32-x64-msvc`) is missing — npm's
 * optional-deps bug (npm/cli#4828) drops those on install, and the npx
 * cache hits it on in-place upgrades. A static import here would take
 * down the whole launcher at boot (#1852); loading on first use instead
 * lets the load failure degrade through the same availability contract
 * as an unreachable keychain (see `KeyringSecretStore`).
 */
let keyringLoad: Promise<KeyringModule | null> | undefined;
let keyringLoadError: unknown;

function loadKeyring(): Promise<KeyringModule | null> {
  keyringLoad ??= import("@napi-rs/keyring").catch((err: unknown) => {
    keyringLoadError = err;
    return null;
  });
  return keyringLoad;
}

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
 * Thrown when the OS keychain is unavailable. Two realistic causes:
 * Linux without libsecret / gnome-keyring installed, and a missing
 * `@napi-rs/keyring` platform binary package (npm's optional-deps bug,
 * npm/cli#4828 — the module itself fails to load, any OS). Surfaced as
 * a 503 by the API handlers so the UI can show an actionable error
 * rather than a generic 500.
 */
export class KeychainUnavailableError extends Error {
  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // The napi-rs loader's throw for a missing platform package starts
    // with this phrase — steer those users to a reinstall instead of
    // the (irrelevant) Linux keyring-daemon advice.
    const hint = message.includes("Cannot find native binding")
      ? `The @napi-rs/keyring platform package for this OS is missing — reinstall the Inspector (for npx, clear the npx cache under your npm cache directory first).`
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
 * **Availability behavior.** When the keychain is unavailable — the
 * module failed to load (missing platform binary, #1852), the entry
 * constructor threw (no reachable secret service, #1848), or the
 * operation itself failed (Linux without libsecret / gnome-keyring) —
 * `set` is the only operation that throws `KeychainUnavailableError`:
 * that's the moment where data would actually be lost. `get` returns
 * `null` (as if no entry existed) and the destructive operations
 * silently no-op (there's nothing to delete anyway). This keeps
 * non-secret flows working on a stock CI runner / minimal Linux box /
 * broken npx-cache install; the user only hits a hard error when they
 * actually try to save a secret.
 */
export class KeyringSecretStore implements SecretStore {
  async get(serverId: string, field: string): Promise<string | null> {
    const keyring = await loadKeyring();
    if (!keyring) return null;
    try {
      // Constructed inside the try: `AsyncEntry::new` performs the
      // platform-store setup and throws when no backend is reachable.
      const entry = new keyring.AsyncEntry(
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
    const keyring = await loadKeyring();
    if (!keyring) throw new KeychainUnavailableError(keyringLoadError);
    try {
      const entry = new keyring.AsyncEntry(
        SERVICE_NAME,
        buildAccount(serverId, field),
      );
      await entry.setPassword(value);
    } catch (err) {
      // The only operation that hard-fails — if we can't persist the
      // secret, the user needs to know now rather than discover later
      // that their value disappeared. Routes translate this to a 503.
      throw new KeychainUnavailableError(err);
    }
  }

  async delete(serverId: string, field: string): Promise<void> {
    const keyring = await loadKeyring();
    if (!keyring) return;
    try {
      const entry = new keyring.AsyncEntry(
        SERVICE_NAME,
        buildAccount(serverId, field),
      );
      await entry.deleteCredential();
    } catch {
      // Both reasons for a throw collapse to the same desired outcome
      // ("the entry isn't there anymore"): `deleteCredential` raises
      // NoEntry for a missing credential, and the native binding
      // raises a runtime error when the keychain itself is unavailable.
      // We treat both as success — there's no value to lose either
      // way, and `set` is the operation that hard-fails when the
      // keychain is actually down.
    }
  }

  async deleteAllForServer(serverId: string): Promise<void> {
    const keyring = await loadKeyring();
    if (!keyring) return;
    let creds: Array<{ account: string; password: string }>;
    try {
      creds = await keyring.findCredentialsAsync(SERVICE_NAME);
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
