/**
 * Contract tests for the secret-store abstraction.
 *
 * `InMemorySecretStore` is exercised directly. `KeyringSecretStore` is
 * exercised via a `vi.mock` of `@napi-rs/keyring` — the native bindings
 * aren't reliably present in CI (Linux runners ship without libsecret),
 * so the suite stubs the native side and asserts the tolerance contract
 * (`get` returns null on failure, destructive ops no-op, `set` is the
 * one operation that hard-fails with `KeychainUnavailableError`).
 *
 * The contract has three entry points for "unavailable" and the suite
 * covers all three: the operation throwing, `AsyncEntry`'s constructor
 * throwing (#1848), and the package failing to load at all (#1905). The
 * last one can't use the shared stub — it needs the *import* to reject —
 * so it lives in its own describe built on `vi.resetModules()`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The mock must be hoisted above the `await import` of secret-store
// inside the `KeyringSecretStore` describe block. Use `vi.hoisted` so
// references are captured before the import is evaluated.
const keyringMocks = vi.hoisted(() => {
  const password = new Map<string, string | null>();
  const reset = () => password.clear();
  // Behavior hooks each test can flip to simulate keychain unavailability
  // on specific operations. Defaults: real-ish in-memory behavior.
  const failures = {
    getThrows: false,
    setThrows: false,
    deleteThrows: false,
    findThrows: false,
    deleteThrowsNoEntry: false,
    // `AsyncEntry::new` itself does the platform-store setup and throws
    // when no backend is reachable (a container with no D-Bus session,
    // Linux without libsecret). Modelling it is what catches #1848: a
    // stub that can only fail per-method leaves the construction path
    // untested, so an escaping constructor error looks green here.
    constructorThrows: false,
  };
  const credentials = (): Array<{ account: string; password: string }> => {
    const out: Array<{ account: string; password: string }> = [];
    for (const [k, v] of password.entries()) {
      if (v !== null) out.push({ account: k, password: v });
    }
    return out;
  };
  class AsyncEntry {
    private readonly key: string;
    constructor(_service: string, username: string) {
      if (failures.constructorThrows) {
        throw new Error(
          "Couldn't access platform storage: PermissionDenied (constructor)",
        );
      }
      this.key = username;
    }
    async getPassword(): Promise<string | undefined> {
      if (failures.getThrows) throw new Error("keychain get unavailable");
      const v = password.get(this.key);
      return v === undefined || v === null ? undefined : v;
    }
    async setPassword(value: string): Promise<void> {
      if (failures.setThrows) throw new Error("keychain set unavailable");
      password.set(this.key, value);
    }
    async deleteCredential(): Promise<boolean> {
      if (failures.deleteThrowsNoEntry) throw new Error("No entry found");
      if (failures.deleteThrows) throw new Error("keychain delete unavailable");
      return password.delete(this.key);
    }
  }
  const findCredentialsAsync = async (): Promise<
    Array<{ account: string; password: string }>
  > => {
    if (failures.findThrows) throw new Error("keychain find unavailable");
    return credentials();
  };
  return { AsyncEntry, findCredentialsAsync, failures, password, reset };
});

vi.mock("@napi-rs/keyring", () => ({
  AsyncEntry: keyringMocks.AsyncEntry,
  findCredentialsAsync: keyringMocks.findCredentialsAsync,
}));

import {
  InMemorySecretStore,
  KeyringSecretStore,
  KeychainUnavailableError,
  SECRET_FIELD_OAUTH_CLIENT_SECRET,
  envSecretField,
  parseAccount,
  type SecretStore,
} from "@inspector/core/auth/node/secret-store.js";

describe("InMemorySecretStore", () => {
  let store: SecretStore;

  beforeEach(() => {
    store = new InMemorySecretStore();
  });

  it("returns null for a missing entry", async () => {
    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      null,
    );
  });

  it("round-trips a value set then get", async () => {
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "shh");
    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      "shh",
    );
  });

  it("treats different server ids as separate namespaces", async () => {
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "alpha-secret");
    await store.set("beta", SECRET_FIELD_OAUTH_CLIENT_SECRET, "beta-secret");
    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      "alpha-secret",
    );
    expect(await store.get("beta", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      "beta-secret",
    );
  });

  it("treats different fields under the same server id as separate entries", async () => {
    await store.set("alpha", envSecretField("API_KEY"), "k1");
    await store.set("alpha", envSecretField("DB_PASS"), "k2");
    expect(await store.get("alpha", envSecretField("API_KEY"))).toBe("k1");
    expect(await store.get("alpha", envSecretField("DB_PASS"))).toBe("k2");
  });

  it("overwrites an existing entry on set", async () => {
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "v1");
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "v2");
    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      "v2",
    );
  });

  it("delete is a no-op for a missing entry", async () => {
    await store.delete("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET);
    // No throw, no state change.
    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      null,
    );
  });

  it("delete removes only the targeted (id, field)", async () => {
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "a");
    await store.set("alpha", envSecretField("KEY"), "b");
    await store.delete("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET);
    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      null,
    );
    expect(await store.get("alpha", envSecretField("KEY"))).toBe("b");
  });

  it("deleteAllForServer removes every field under that id", async () => {
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "a");
    await store.set("alpha", envSecretField("KEY1"), "b");
    await store.set("alpha", envSecretField("KEY2"), "c");
    await store.set("beta", SECRET_FIELD_OAUTH_CLIENT_SECRET, "untouched");

    await store.deleteAllForServer("alpha");

    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      null,
    );
    expect(await store.get("alpha", envSecretField("KEY1"))).toBe(null);
    expect(await store.get("alpha", envSecretField("KEY2"))).toBe(null);
    expect(await store.get("beta", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      "untouched",
    );
  });

  it("deleteAllForServer does not delete entries on a different id that happens to share a prefix", async () => {
    // The account scheme is `${serverId}:${field}` — a literal prefix match
    // would incorrectly sweep "alpha-prime" entries when deleting "alpha".
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "a");
    await store.set("alpha-prime", SECRET_FIELD_OAUTH_CLIENT_SECRET, "p");

    await store.deleteAllForServer("alpha");

    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      null,
    );
    expect(
      await store.get("alpha-prime", SECRET_FIELD_OAUTH_CLIENT_SECRET),
    ).toBe("p");
  });

  it("round-trips an empty-string value (set + get returns '')", async () => {
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "");
    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe("");
  });
});

describe("parseAccount", () => {
  it("splits `${serverId}:${field}` on the first colon", () => {
    expect(parseAccount("srv:oauth-client-secret")).toEqual({
      serverId: "srv",
      field: "oauth-client-secret",
    });
  });

  it("allows the field to contain colons (env:KEY uses one)", () => {
    expect(parseAccount("srv:env:API_KEY")).toEqual({
      serverId: "srv",
      field: "env:API_KEY",
    });
  });

  it("returns null when no separator is present", () => {
    expect(parseAccount("noseparator")).toBe(null);
  });

  it("returns null for a leading or trailing colon (empty side)", () => {
    expect(parseAccount(":field")).toBe(null);
    expect(parseAccount("srv:")).toBe(null);
  });
});

describe("KeyringSecretStore (mocked native bindings)", () => {
  let store: KeyringSecretStore;

  beforeEach(() => {
    keyringMocks.reset();
    keyringMocks.failures.getThrows = false;
    keyringMocks.failures.setThrows = false;
    keyringMocks.failures.deleteThrows = false;
    keyringMocks.failures.findThrows = false;
    keyringMocks.failures.deleteThrowsNoEntry = false;
    keyringMocks.failures.constructorThrows = false;
    store = new KeyringSecretStore();
  });

  it("round-trips a set then get", async () => {
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "shh");
    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      "shh",
    );
  });

  it("get returns null when getPassword throws (keychain unavailable)", async () => {
    // get is tolerant: there's no value to surface so degrading to "null"
    // matches the absence semantic the caller already handles.
    keyringMocks.failures.getThrows = true;
    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      null,
    );
  });

  it("get returns null when the underlying entry is absent (no value set)", async () => {
    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      null,
    );
  });

  it("set throws KeychainUnavailableError when setPassword throws", async () => {
    // set is the one operation that hard-fails — losing data silently
    // is worse than surfacing a clear error the user can act on.
    keyringMocks.failures.setThrows = true;
    await expect(
      store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "v"),
    ).rejects.toBeInstanceOf(KeychainUnavailableError);
  });

  it("delete silently treats a 'no entry' error as success", async () => {
    keyringMocks.failures.deleteThrowsNoEntry = true;
    await expect(
      store.delete("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET),
    ).resolves.toBeUndefined();
  });

  it("delete silently no-ops when the keychain is unavailable", async () => {
    keyringMocks.failures.deleteThrows = true;
    await expect(
      store.delete("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET),
    ).resolves.toBeUndefined();
  });

  it("delete actually removes the value when the keychain is available", async () => {
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "v");
    await store.delete("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET);
    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      null,
    );
  });

  it("deleteAllForServer no-ops when findCredentialsAsync throws", async () => {
    // We don't even know what was written, so there's nothing to sweep.
    // Critically, this must not throw — the route's defensive sweep on
    // POST and DELETE depends on it.
    keyringMocks.failures.findThrows = true;
    await expect(store.deleteAllForServer("alpha")).resolves.toBeUndefined();
  });

  it("deleteAllForServer removes every entry under the given id", async () => {
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "a");
    await store.set("alpha", envSecretField("K"), "b");
    await store.set("beta", SECRET_FIELD_OAUTH_CLIENT_SECRET, "untouched");

    await store.deleteAllForServer("alpha");

    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      null,
    );
    expect(await store.get("alpha", envSecretField("K"))).toBe(null);
    expect(await store.get("beta", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      "untouched",
    );
  });

  it("deleteAllForServer ignores entries on a different id that share a prefix", async () => {
    // The `parseAccount` check guards against a literal startsWith match
    // wrongly sweeping `alpha-prime:...` when deleting `alpha`.
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "a");
    await store.set("alpha-prime", SECRET_FIELD_OAUTH_CLIENT_SECRET, "p");

    await store.deleteAllForServer("alpha");

    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      null,
    );
    expect(
      await store.get("alpha-prime", SECRET_FIELD_OAUTH_CLIENT_SECRET),
    ).toBe("p");
  });

  it("KeychainUnavailableError stringifies a non-Error cause", () => {
    const err = new KeychainUnavailableError("plain string cause");
    expect(err).toBeInstanceOf(KeychainUnavailableError);
    expect(err.message).toContain("plain string cause");
    expect(err.message).toMatch(/libsecret/);
  });

  // The two hint branches are asserted by direct construction rather than
  // through the store: the unloadable-package path can only be reached via
  // a throwing `vi.doMock` factory, and vitest substitutes its own "error
  // when mocking a module" message for whatever that factory throws — so
  // the real loader text never reaches the constructor from there. These
  // two cases pin the wording against the message the napi-rs loader
  // actually produces.
  it("KeychainUnavailableError steers a missing native binding to a reinstall", () => {
    const err = new KeychainUnavailableError(
      new Error(
        "Cannot find native binding. npm has a bug related to optional dependencies…",
      ),
    );
    expect(err.message).toMatch(/reinstall the Inspector/);
    expect(err.message).toMatch(/npx cache/);
    // The Linux keyring-daemon advice is irrelevant to this cause.
    expect(err.message).not.toMatch(/libsecret/);
    expect(err.message).toMatch(/Cannot find native binding/);
  });

  it("KeychainUnavailableError keeps the libsecret advice for other causes", () => {
    const err = new KeychainUnavailableError(
      new Error("failed to unlock the default collection"),
    );
    expect(err.message).toMatch(/libsecret/);
    expect(err.message).not.toMatch(/reinstall the Inspector/);
  });

  it("KeychainUnavailableError carries the underlying error message", async () => {
    keyringMocks.failures.setThrows = true;
    try {
      await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "v");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(KeychainUnavailableError);
      expect((err as Error).message).toMatch(/keychain set unavailable/);
      expect((err as Error).message).toMatch(/libsecret/);
    }
  });

  describe("keychain unreachable at AsyncEntry construction (#1848)", () => {
    // `AsyncEntry::new` — not just its methods — throws when no platform
    // store is reachable. The degradation contract must hold identically
    // for that failure mode; constructing outside the `try` let the raw
    // keyring error escape and 500 `GET /api/servers` before any secret
    // was touched.
    beforeEach(() => {
      keyringMocks.failures.constructorThrows = true;
    });

    it("get returns null", async () => {
      expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
        null,
      );
    });

    it("set throws KeychainUnavailableError, not the raw keyring error", async () => {
      // The typed error is what the routes translate to a 503 and what
      // `migratePlaintextSecrets` matches on to skip migration.
      await expect(
        store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "v"),
      ).rejects.toBeInstanceOf(KeychainUnavailableError);
      await expect(
        store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "v"),
      ).rejects.toThrow(/Couldn't access platform storage/);
    });

    it("delete silently no-ops", async () => {
      await expect(
        store.delete("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET),
      ).resolves.toBeUndefined();
    });

    it("deleteAllForServer no-ops even when the credential sweep finds entries", async () => {
      // findCredentialsAsync can succeed while per-entry construction
      // fails; the sweep must still resolve rather than escape.
      keyringMocks.failures.constructorThrows = false;
      await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "a");
      keyringMocks.failures.constructorThrows = true;

      await expect(store.deleteAllForServer("alpha")).resolves.toBeUndefined();
    });
  });
});

describe("@napi-rs/keyring unloadable on this platform (#1905)", () => {
  // `@napi-rs/keyring` ships one prebuilt binary per platform triple and
  // throws on import where it has none — Android / Termux is the reported
  // case. A static top-level import made that a startup crash: the module
  // never evaluated, so none of the tolerance handling could run.
  //
  // The shared stub above can't express this: it models a keyring that
  // loads. Here the *import itself* rejects, which needs a fresh module
  // registry — hence `vi.resetModules()` + `vi.doMock` and a re-import
  // rather than a flag. The re-imported module is a distinct instance, so
  // its `KeychainUnavailableError` is a distinct class identity too; the
  // assertions below use the freshly imported one.
  // The real-world message on Termux. Documentary here — see the cause
  // assertion below for why vitest doesn't let it through verbatim.
  const LOAD_ERROR = "Cannot find module '@napi-rs/keyring-android-arm64'";

  /** Fresh secret-store module whose `@napi-rs/keyring` import rejects. */
  const importWithUnloadableKeyring = async (
    onLoadAttempt: () => void = () => {},
  ) => {
    vi.resetModules();
    vi.doMock("@napi-rs/keyring", () => {
      onLoadAttempt();
      throw new Error(LOAD_ERROR);
    });
    return await import("@inspector/core/auth/node/secret-store.js");
  };

  afterEach(() => {
    vi.doUnmock("@napi-rs/keyring");
    vi.resetModules();
  });

  it("the module still evaluates — importing it must not throw", async () => {
    // The regression itself: with a static top-level import this rejects,
    // and the Inspector exits before reaching any fallback.
    await expect(importWithUnloadableKeyring()).resolves.toHaveProperty(
      "KeyringSecretStore",
    );
  });

  it("get returns null", async () => {
    const mod = await importWithUnloadableKeyring();
    const store = new mod.KeyringSecretStore();
    expect(await store.get("alpha", "oauth-client-secret")).toBe(null);
  });

  it("set throws KeychainUnavailableError carrying the load failure as its cause", async () => {
    const mod = await importWithUnloadableKeyring();
    const store = new mod.KeyringSecretStore();
    await expect(
      store.set("alpha", "oauth-client-secret", "v"),
    ).rejects.toBeInstanceOf(mod.KeychainUnavailableError);
    // Asserted by shape, not by the literal text: vitest substitutes its
    // own "error when mocking a module" message for a throwing `doMock`
    // factory, so `LOAD_ERROR` never reaches the store here. What matters
    // — and what is testable — is that the load failure is appended as
    // the cause rather than swallowed. In production the real
    // "Cannot find native binding" text lands in that slot.
    await expect(
      store.set("alpha", "oauth-client-secret", "v"),
    ).rejects.toThrow(/Underlying error: .+/);
  });

  it("set does not double-wrap the typed error", async () => {
    // The load failure is already a `KeychainUnavailableError` by the time
    // the catch sees it; re-wrapping would bury the cause a level deeper.
    const mod = await importWithUnloadableKeyring();
    const store = new mod.KeyringSecretStore();
    try {
      await store.set("alpha", "oauth-client-secret", "v");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(mod.KeychainUnavailableError);
      // One "OS keychain is not available" prefix, not two nested.
      expect(
        (err as Error).message.match(/OS keychain is not available/g),
      ).toHaveLength(1);
    }
  });

  it("delete and deleteAllForServer silently no-op", async () => {
    const mod = await importWithUnloadableKeyring();
    const store = new mod.KeyringSecretStore();
    await expect(
      store.delete("alpha", "oauth-client-secret"),
    ).resolves.toBeUndefined();
    await expect(store.deleteAllForServer("alpha")).resolves.toBeUndefined();
  });

  it("attempts the load once and caches the failure", async () => {
    // Without the cache every secret operation re-attempts (and re-throws)
    // the resolution — `expectedSecretFields` means that is once per
    // server per `GET /api/servers`.
    const onLoadAttempt = vi.fn();
    const mod = await importWithUnloadableKeyring(onLoadAttempt);
    const store = new mod.KeyringSecretStore();

    await store.get("alpha", "oauth-client-secret");
    await store.get("beta", "oauth-client-secret");
    await store.delete("alpha", "oauth-client-secret");

    expect(onLoadAttempt).toHaveBeenCalledTimes(1);
  });
});

describe("@napi-rs/keyring loads but exposes the wrong shape", () => {
  // The package is CJS, so `AsyncEntry` / `findCredentialsAsync` reach us
  // through named-export interop. That holds today — verified against the
  // real package — but if it ever stopped (a default-only export upstream,
  // a bundler changing interop, a platform where named-export detection
  // fails), the members would be `undefined` and `new undefined(...)` would
  // throw a TypeError *inside* the try that implements degradation.
  //
  // What the shape check fixes is the *diagnosis*, not the data loss: `get`
  // returns null with or without it (read-tolerance is its contract), so
  // the empty secret list looks the same either way. The difference is that
  // `set` names the shape problem at the load boundary instead of reporting
  // "keyring.mod.AsyncEntry is not a constructor". Only the cause-message
  // test below actually fails without the guard — the others pin the
  // surrounding contract and would pass either way.
  const importWithKeyringShape = async (shape: Record<string, unknown>) => {
    vi.resetModules();
    vi.doMock("@napi-rs/keyring", () => shape);
    return await import("@inspector/core/auth/node/secret-store.js");
  };

  afterEach(() => {
    vi.doUnmock("@napi-rs/keyring");
    vi.resetModules();
  });

  // The members are declared but not callable, rather than absent. That is
  // the shape a default-only export would leave behind, and it keeps these
  // cases on the `typeof !== "function"` branch deterministically: vitest's
  // module mock *throws* on reading a key the factory never returned, which
  // is a different path (covered by its own case at the end).
  const ENTRY_NOT_A_FUNCTION = {
    AsyncEntry: undefined,
    findCredentialsAsync: async () => [],
  };

  it("treats a namespace without a callable AsyncEntry as unavailable rather than returning null secrets", async () => {
    const mod = await importWithKeyringShape(ENTRY_NOT_A_FUNCTION);
    const store = new mod.KeyringSecretStore();

    // The dangerous half: a silent `null` here is indistinguishable from
    // "no secret stored", which is why `set` must hard-fail below.
    expect(await store.get("alpha", "oauth-client-secret")).toBe(null);
    await expect(
      store.set("alpha", "oauth-client-secret", "v"),
    ).rejects.toBeInstanceOf(mod.KeychainUnavailableError);
  });

  it("names the shape problem as the cause, not a bare unavailability", async () => {
    const mod = await importWithKeyringShape(ENTRY_NOT_A_FUNCTION);
    const store = new mod.KeyringSecretStore();
    try {
      await store.set("alpha", "oauth-client-secret", "v");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error).message).toMatch(
        /did not expose AsyncEntry \/ findCredentialsAsync/,
      );
      // Not double-wrapped: the load failure is already typed by the time
      // `set`'s catch sees it.
      expect(
        (err as Error).message.match(/OS keychain is not available/g),
      ).toHaveLength(1);
    }
  });

  it("treats a namespace without a callable findCredentialsAsync as unavailable too", async () => {
    // `deleteAllForServer` is the only caller of it, so a shape check on
    // `AsyncEntry` alone would let this one through to a TypeError.
    class StubEntry {
      async getPassword(): Promise<string | undefined> {
        return undefined;
      }
    }
    const mod = await importWithKeyringShape({
      AsyncEntry: StubEntry,
      findCredentialsAsync: undefined,
    });
    const store = new mod.KeyringSecretStore();

    await expect(
      store.set("alpha", "oauth-client-secret", "v"),
    ).rejects.toBeInstanceOf(mod.KeychainUnavailableError);
    await expect(store.deleteAllForServer("alpha")).resolves.toBeUndefined();
  });

  it("treats a namespace that throws on member access as unavailable", async () => {
    // Reading a missing export is not always a harmless `undefined` — a
    // Proxy-backed namespace can throw, and vitest's module mock does. If
    // that throw escaped the shape check it would reject the *cached*
    // promise, so the check has to absorb it and report unavailable.
    const mod = await importWithKeyringShape({});
    const store = new mod.KeyringSecretStore();

    expect(await store.get("alpha", "oauth-client-secret")).toBe(null);
    await expect(
      store.set("alpha", "oauth-client-secret", "v"),
    ).rejects.toBeInstanceOf(mod.KeychainUnavailableError);
    // Absorbed, not escaped: a rejected cached promise would surface here
    // as the raw access error instead of the typed one.
    await expect(store.deleteAllForServer("alpha")).resolves.toBeUndefined();
  });

  it("accepts a well-formed namespace", async () => {
    // The guard must not reject the shape the package actually ships —
    // otherwise it would turn a working keychain into a permanent 503.
    const stored = new Map<string, string>();
    class StubEntry {
      // Declared explicitly rather than as a constructor parameter
      // property: those are disallowed under `erasableSyntaxOnly`.
      private readonly account: string;
      constructor(_service: string, account: string) {
        this.account = account;
      }
      async getPassword(): Promise<string | undefined> {
        return stored.get(this.account);
      }
      async setPassword(value: string): Promise<void> {
        stored.set(this.account, value);
      }
      async deleteCredential(): Promise<boolean> {
        return stored.delete(this.account);
      }
    }
    const mod = await importWithKeyringShape({
      AsyncEntry: StubEntry,
      findCredentialsAsync: async () => [],
    });
    const store = new mod.KeyringSecretStore();

    await store.set("alpha", "oauth-client-secret", "shh");
    expect(await store.get("alpha", "oauth-client-secret")).toBe("shh");
  });
});
