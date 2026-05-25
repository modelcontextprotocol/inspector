/**
 * Contract tests for the secret-store abstraction.
 *
 * The keyring-backed default implementation needs platform native bindings
 * (libsecret on Linux) that aren't reliably present in CI, so the suite
 * exercises the `InMemorySecretStore` here — the same interface the
 * production code is tested against via the `/api/servers` integration
 * suite (which injects this in-memory impl). Coverage of the keyring
 * adapter itself is exercised by hand on macOS/Windows during development.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemorySecretStore,
  SECRET_FIELD_OAUTH_CLIENT_SECRET,
  envSecretField,
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
