/**
 * The behavioral contract every `SecretStore` implementation must satisfy,
 * as a reusable block of `it()`s.
 *
 * These assertions were written once against `InMemorySecretStore` and are
 * now shared with `FileSecretStore` (#1950), which is the point: the whole
 * design rests on callers not knowing which store they got, and a contract
 * asserted against only one implementation cannot support that claim. The
 * cases that matter most are the two that look like edge cases and are
 * not — the empty-string value (a real value that must round-trip, which
 * is why the interface returns `null` for "absent" rather than falsy) and
 * the shared-prefix server id (`alpha` vs `alpha-prime`, where a literal
 * prefix sweep in `deleteAllForServer` deletes the wrong server's
 * secrets).
 *
 * `KeyringSecretStore` is deliberately *not* run through this block: it
 * has no reachable backend in CI, so its own file drives a mocked native
 * layer and asserts the failure half of the contract instead.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SecretStore } from "@inspector/core/auth/node/secret-store.js";
import {
  SECRET_FIELD_OAUTH_CLIENT_SECRET,
  envSecretField,
} from "@inspector/core/auth/secret-fields.js";

/**
 * @param name  Suite label.
 * @param makeStore  Produces a *fresh, empty* store. Called per test — a
 *   file-backed implementation uses this to point at a new temp path, so
 *   the shared cases stay ignorant of where the state lives.
 */
export function describeSecretStoreContract(
  name: string,
  makeStore: () => SecretStore | Promise<SecretStore>,
): void {
  describe(`${name} (SecretStore contract)`, () => {
    let store: SecretStore;

    beforeEach(async () => {
      store = await makeStore();
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
      await store.set(
        "alpha",
        SECRET_FIELD_OAUTH_CLIENT_SECRET,
        "alpha-secret",
      );
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
      expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
        "",
      );
    });
  });
}
