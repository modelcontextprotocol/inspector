/**
 * Contract tests for the secret-store abstraction.
 *
 * `InMemorySecretStore` is exercised directly. `KeyringSecretStore` is
 * exercised via a `vi.mock` of `@napi-rs/keyring` — the native bindings
 * aren't reliably present in CI (Linux runners ship without libsecret),
 * so the suite stubs the native side and asserts the tolerance contract
 * (`get` returns null on failure, destructive ops no-op, `set` is the
 * one operation that hard-fails with `KeychainUnavailableError`).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

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
});
