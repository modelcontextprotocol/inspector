/**
 * Integration tests for the per-state-file secrets namespace (#2549):
 * isolation between two state files sharing a server, adoption of a legacy
 * (un-namespaced) file's store entries, fresh-file minting, invalid
 * namespaces, adoption rollback, and keyring-backend isolation (the issue's
 * acceptance criterion — exercised via the mocked `@napi-rs/keyring`
 * bindings, the same pattern as secret-store.test.ts, since the real
 * keychain is unreachable in CI).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Hoisted above the secret-store import so KeyringSecretStore binds to the
// in-memory fake instead of the native module (absent in CI).
const keyringMocks = vi.hoisted(() => {
  const password = new Map<string, string | null>();
  class AsyncEntry {
    private readonly key: string;
    constructor(_service: string, username: string) {
      this.key = username;
    }
    async getPassword(): Promise<string | undefined> {
      const v = password.get(this.key);
      return v === undefined || v === null ? undefined : v;
    }
    async setPassword(value: string): Promise<void> {
      password.set(this.key, value);
    }
    async deleteCredential(): Promise<boolean> {
      return password.delete(this.key);
    }
  }
  const findCredentialsAsync = async (): Promise<
    Array<{ account: string; password: string }>
  > => {
    const out: Array<{ account: string; password: string }> = [];
    for (const [k, v] of password.entries()) {
      if (v !== null) out.push({ account: k, password: v });
    }
    return out;
  };
  return { AsyncEntry, findCredentialsAsync, password };
});

vi.mock("@napi-rs/keyring", () => ({
  AsyncEntry: keyringMocks.AsyncEntry,
  findCredentialsAsync: keyringMocks.findCredentialsAsync,
}));

// Passthrough mock so one test can make adoption's stamp write fail at the
// commit point; every other call runs the real implementation.
vi.mock("@inspector/core/storage/store-io.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@inspector/core/storage/store-io.js")
    >();
  return {
    ...actual,
    writeStoreFile: vi.fn(actual.writeStoreFile),
  };
});

import {
  writeOAuthSections,
  readOAuthStore,
  removeOAuthStore,
  resetOAuthSecretStoreWarnings,
  SECRETS_NAMESPACE_KEY,
} from "@inspector/core/auth/node/oauth-persist-file.js";
import {
  InMemorySecretStore,
  KeyringSecretStore,
  type SecretStore,
} from "@inspector/core/auth/node/secret-store.js";
import { FileSecretStore } from "@inspector/core/auth/node/file-secret-store.js";
import {
  namespaceLedgerPath,
  resetNamespaceLedgerWarnings,
} from "@inspector/core/auth/node/oauth-namespace-ledger.js";
import {
  PERSIST_TOKENS_ENV,
  oauthSecretServerId,
  oauthIdpSecretServerId,
  isValidSecretsNamespace,
  LEGACY_TOKENS_FIELD,
  IDP_SESSION_FIELD,
  resetPersistTokensPolicyWarnings,
} from "@inspector/core/auth/node/oauth-secrets.js";
import {
  writeStoreFile,
  flushStoreFileWrites,
} from "@inspector/core/storage/store-io.js";
import type { OAuthPersistSnapshot } from "@inspector/core/auth/oauth-persist.js";

const SERVER = "https://api.example/mcp";
const ISSUER = "https://as.example";

function tokensFor(tag: string) {
  return {
    access_token: `at-${tag}`,
    token_type: "Bearer",
    refresh_token: `rt-${tag}`,
  };
}

function snapshotFor(tag: string): OAuthPersistSnapshot {
  return {
    servers: { [SERVER]: { scope: "read", tokens: tokensFor(tag) } },
    idpSessions: {},
  };
}

function namespaceOf(filePath: string): string {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<
    string,
    unknown
  >;
  return parsed[SECRETS_NAMESPACE_KEY] as string;
}

let tempDir: string;
let fileA: string;
let fileB: string;
let savedPolicy: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "inspector-oauth-ns-"));
  fileA = join(tempDir, "profile-a.json");
  fileB = join(tempDir, "profile-b.json");
  savedPolicy = process.env[PERSIST_TOKENS_ENV];
  delete process.env[PERSIST_TOKENS_ENV];
  keyringMocks.password.clear();
});

afterEach(() => {
  if (savedPolicy === undefined) delete process.env[PERSIST_TOKENS_ENV];
  else process.env[PERSIST_TOKENS_ENV] = savedPolicy;
  resetPersistTokensPolicyWarnings();
  resetOAuthSecretStoreWarnings();
  resetNamespaceLedgerWarnings();
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

async function flushBoth(): Promise<void> {
  await flushStoreFileWrites(fileA);
  await flushStoreFileWrites(fileB);
}

/** The issue's core scenario, parameterized over the shared store backend. */
async function assertTwoProfileIsolation(store: SecretStore): Promise<void> {
  await writeOAuthSections(fileA, snapshotFor("a"), undefined, store);
  await writeOAuthSections(fileB, snapshotFor("b"), undefined, store);
  await flushBoth();

  const nsA = namespaceOf(fileA);
  const nsB = namespaceOf(fileB);
  expect(nsA).not.toBe(nsB);
  expect(oauthSecretServerId(SERVER, nsA)).not.toBe(
    oauthSecretServerId(SERVER, nsB),
  );

  // B's save must not have clobbered A's entry for the same server.
  const readA = await readOAuthStore(fileA, store);
  const readB = await readOAuthStore(fileB, store);
  expect(readA?.servers[SERVER]?.tokens).toEqual(tokensFor("a"));
  expect(readB?.servers[SERVER]?.tokens).toEqual(tokensFor("b"));
}

describe("secrets namespace isolation (#2549)", () => {
  it("keeps two state files' tokens for the same server apart in one shared store", async () => {
    await assertTwoProfileIsolation(new InMemorySecretStore());
  });

  it("keeps them apart on the keyring backend too (acceptance criterion)", async () => {
    await assertTwoProfileIsolation(new KeyringSecretStore());
    // Both namespaced accounts coexist in the shared keychain.
    const accounts = [...keyringMocks.password.keys()];
    expect(
      accounts.filter((a) => a.includes(encodeURIComponent(SERVER))),
    ).toHaveLength(2);
  });

  it("keeps them apart on the file backend too (acceptance criterion)", async () => {
    // The real FileSecretStore: nested secrets-file locking and serialized
    // whole-file mutations are backend-specific and not represented by the
    // in-memory double.
    await assertTwoProfileIsolation(
      new FileSecretStore({ filePath: join(tempDir, "secrets.json") }),
    );
  });

  it("mints a valid namespace on a fresh file's first write and keeps it on later saves", async () => {
    const store = new InMemorySecretStore();
    await writeOAuthSections(fileA, snapshotFor("a"), undefined, store);
    await flushStoreFileWrites(fileA);
    const ns = namespaceOf(fileA);
    expect(isValidSecretsNamespace(ns)).toBe(true);

    await writeOAuthSections(
      fileA,
      { servers: { [SERVER]: { scope: "write" } }, idpSessions: {} },
      { servers: [SERVER] },
      store,
    );
    await flushStoreFileWrites(fileA);
    expect(namespaceOf(fileA)).toBe(ns);
  });

  it("removing one profile's state purges only its own entries, not the other's", async () => {
    const store = new InMemorySecretStore();
    await writeOAuthSections(fileA, snapshotFor("a"), undefined, store);
    await writeOAuthSections(fileB, snapshotFor("b"), undefined, store);
    await flushBoth();
    const idB = oauthSecretServerId(SERVER, namespaceOf(fileB));

    await removeOAuthStore(fileA, store);

    // B's scoped entry survives A's removal, and B still reads back whole.
    expect(await store.get(idB, LEGACY_TOKENS_FIELD)).not.toBeNull();
    const readB = await readOAuthStore(fileB, store);
    expect(readB?.servers[SERVER]?.tokens).toEqual(tokensFor("b"));
  });
});

describe("legacy adoption (#2549)", () => {
  /** A pre-namespace file plus its legacy unscoped store entries. */
  async function seedLegacy(store: SecretStore): Promise<void> {
    await writeStoreFile(
      fileA,
      JSON.stringify({
        servers: { [SERVER]: { scope: "read" } },
        idpSessions: { [ISSUER]: { clientInformation: { client_id: "idp" } } },
      }),
    );
    await flushStoreFileWrites(fileA);
    await store.set(
      oauthSecretServerId(SERVER),
      LEGACY_TOKENS_FIELD,
      JSON.stringify(tokensFor("legacy")),
    );
    await store.set(
      oauthIdpSecretServerId(ISSUER),
      IDP_SESSION_FIELD,
      JSON.stringify({ tokens: tokensFor("idp") }),
    );
  }

  it("first write stamps a namespace, moves legacy entries under it, and deletes the originals", async () => {
    const store = new InMemorySecretStore();
    await seedLegacy(store);

    // A sectioned save touching an unrelated server triggers adoption.
    await writeOAuthSections(
      fileA,
      {
        servers: { "https://other.example": { scope: "x" } },
        idpSessions: {},
      },
      { servers: ["https://other.example"] },
      store,
    );
    await flushStoreFileWrites(fileA);

    const ns = namespaceOf(fileA);
    expect(isValidSecretsNamespace(ns)).toBe(true);
    expect(
      await store.get(oauthSecretServerId(SERVER, ns), LEGACY_TOKENS_FIELD),
    ).toBe(JSON.stringify(tokensFor("legacy")));
    expect(
      await store.get(oauthIdpSecretServerId(ISSUER, ns), IDP_SESSION_FIELD),
    ).toBe(JSON.stringify({ tokens: tokensFor("idp") }));
    // The shared legacy slots are retired.
    expect(
      await store.get(oauthSecretServerId(SERVER), LEGACY_TOKENS_FIELD),
    ).toBeNull();
    expect(
      await store.get(oauthIdpSecretServerId(ISSUER), IDP_SESSION_FIELD),
    ).toBeNull();

    // Joined read-back still sees the moved tokens.
    const read = await readOAuthStore(fileA, store);
    expect(read?.servers[SERVER]?.tokens).toEqual(tokensFor("legacy"));
  });

  it("re-adopts under a fresh namespace when the stamp is stripped", async () => {
    const store = new InMemorySecretStore();
    await seedLegacy(store);
    // Simulate a file whose namespace stamp was lost (hand-edit, partial
    // restore): earlier scoped entries exist, the file reads as legacy, and
    // the next save re-adopts under a brand-new UUID.
    await writeOAuthSections(fileA, snapshotFor("scoped"), undefined, store);
    await flushStoreFileWrites(fileA);
    const ns = namespaceOf(fileA);
    const parsed = JSON.parse(readFileSync(fileA, "utf8")) as Record<
      string,
      unknown
    >;
    delete parsed[SECRETS_NAMESPACE_KEY];
    await writeStoreFile(fileA, JSON.stringify(parsed));
    await flushStoreFileWrites(fileA);
    await store.set(
      oauthSecretServerId(SERVER),
      LEGACY_TOKENS_FIELD,
      JSON.stringify(tokensFor("stale-legacy")),
    );

    await writeOAuthSections(
      fileA,
      {
        servers: { "https://other.example": { scope: "x" } },
        idpSessions: {},
      },
      { servers: ["https://other.example"] },
      store,
    );
    await flushStoreFileWrites(fileA);

    // The re-adoption minted a new UUID, so read it back from the file.
    const ns2 = namespaceOf(fileA);
    expect(ns2).not.toBe(ns);
    expect(
      await store.get(oauthSecretServerId(SERVER, ns2), LEGACY_TOKENS_FIELD),
    ).toBe(JSON.stringify(tokensFor("stale-legacy")));
  });

  it("a failed legacy purge still attempts every remaining legacy id", async () => {
    const store = new InMemorySecretStore();
    await seedLegacy(store);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The first purge (the server's legacy id) fails; the idp session's
    // must still be attempted rather than abandoned (best-effort per id).
    const realDelete = store.deleteAllForServer.bind(store);
    vi.spyOn(store, "deleteAllForServer").mockImplementation(async (id) => {
      if (id === oauthSecretServerId(SERVER)) {
        throw new Error("purge refused");
      }
      return realDelete(id);
    });

    await writeOAuthSections(
      fileA,
      {
        servers: { "https://other.example": { scope: "x" } },
        idpSessions: {},
      },
      { servers: ["https://other.example"] },
      store,
    );
    await flushStoreFileWrites(fileA);

    const ns = namespaceOf(fileA);
    // Both moves landed, and the idp legacy original was purged despite the
    // earlier server purge failing.
    expect(
      await store.get(oauthSecretServerId(SERVER, ns), LEGACY_TOKENS_FIELD),
    ).toBe(JSON.stringify(tokensFor("legacy")));
    expect(
      await store.get(oauthIdpSecretServerId(ISSUER, ns), IDP_SESSION_FIELD),
    ).toBe(JSON.stringify({ tokens: tokensFor("idp") }));
    expect(
      await store.get(oauthIdpSecretServerId(ISSUER), IDP_SESSION_FIELD),
    ).toBeNull();
    // The failed purge left its legacy original behind, warned not thrown.
    expect(
      await store.get(oauthSecretServerId(SERVER), LEGACY_TOKENS_FIELD),
    ).toBe(JSON.stringify(tokensFor("legacy")));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("legacy un-namespaced secret-store entries"),
    );
  });

  it("an invalid secretsNamespace is ignored on read (legacy ids) and replaced on save", async () => {
    const store = new InMemorySecretStore();
    await writeStoreFile(
      fileA,
      JSON.stringify({
        [SECRETS_NAMESPACE_KEY]: "bad+delimiter",
        servers: { [SERVER]: { scope: "read" } },
        idpSessions: {},
      }),
    );
    await flushStoreFileWrites(fileA);
    await store.set(
      oauthSecretServerId(SERVER),
      LEGACY_TOKENS_FIELD,
      JSON.stringify(tokensFor("legacy")),
    );

    // Read resolves through legacy ids, never the invalid value.
    const read = await readOAuthStore(fileA, store);
    expect(read?.servers[SERVER]?.tokens).toEqual(tokensFor("legacy"));

    // A save (touching an unrelated server) treats the file as legacy:
    // mints a fresh valid namespace and moves the legacy entry under it.
    await writeOAuthSections(
      fileA,
      {
        servers: { "https://other.example": { scope: "x" } },
        idpSessions: {},
      },
      { servers: ["https://other.example"] },
      store,
    );
    await flushStoreFileWrites(fileA);
    const ns = namespaceOf(fileA);
    expect(isValidSecretsNamespace(ns)).toBe(true);
    expect(
      await store.get(oauthSecretServerId(SERVER, ns), LEGACY_TOKENS_FIELD),
    ).toBe(JSON.stringify(tokensFor("legacy")));
  });

  it("rolls the copied entries back when adoption cannot complete", async () => {
    const store = new InMemorySecretStore();
    await seedLegacy(store);
    // First scoped copy lands, second throws → the first must be restored
    // and the legacy entries left untouched for the retry.
    const realSet = store.set.bind(store);
    let sets = 0;
    vi.spyOn(store, "set").mockImplementation(async (id, field, value) => {
      sets += 1;
      if (sets === 2) throw new Error("keychain write refused");
      await realSet(id, field, value);
    });

    await expect(
      writeOAuthSections(fileA, snapshotFor("new"), undefined, store),
    ).rejects.toThrow("keychain write refused");

    // Legacy entries are intact; no stamped namespace reached the file.
    expect(
      await store.get(oauthSecretServerId(SERVER), LEGACY_TOKENS_FIELD),
    ).toBe(JSON.stringify(tokensFor("legacy")));
    expect(
      await store.get(oauthIdpSecretServerId(ISSUER), IDP_SESSION_FIELD),
    ).toBe(JSON.stringify({ tokens: tokensFor("idp") }));
    const parsed = JSON.parse(readFileSync(fileA, "utf8")) as Record<
      string,
      unknown
    >;
    expect(parsed[SECRETS_NAMESPACE_KEY]).toBeUndefined();
  });

  it("rolls the scoped copies back when the commit-point stamp write fails", async () => {
    const store = new InMemorySecretStore();
    await seedLegacy(store);
    // Copies land, then the state-file stamp — the migration's commit
    // point — rejects. The copies must be removed and the legacy file and
    // ids left authoritative for the retry. Only the state file's write
    // fails: the namespace ledger (#2560) is written first, to its own path.
    const real = vi.mocked(writeStoreFile).getMockImplementation()!;
    vi.mocked(writeStoreFile).mockImplementation(async (path, data) => {
      if (path === fileA) throw new Error("disk full during stamp");
      return real(path, data);
    });

    try {
      await expect(
        writeOAuthSections(fileA, snapshotFor("new"), undefined, store),
      ).rejects.toThrow("disk full during stamp");
    } finally {
      vi.mocked(writeStoreFile).mockImplementation(real);
    }

    // The namespace the failed stamp would have committed (from the blob
    // handed to the rejected write) holds no copies.
    const attempted = vi
      .mocked(writeStoreFile)
      .mock.calls.filter(([path]) => path === fileA)
      .at(-1)?.[1];
    const ns = (JSON.parse(attempted as string) as Record<string, unknown>)[
      SECRETS_NAMESPACE_KEY
    ] as string;
    expect(isValidSecretsNamespace(ns)).toBe(true);
    expect(
      await store.get(oauthSecretServerId(SERVER, ns), LEGACY_TOKENS_FIELD),
    ).toBeNull();
    expect(
      await store.get(oauthIdpSecretServerId(ISSUER, ns), IDP_SESSION_FIELD),
    ).toBeNull();
    // Legacy entries are intact and the file is still un-stamped.
    expect(
      await store.get(oauthSecretServerId(SERVER), LEGACY_TOKENS_FIELD),
    ).toBe(JSON.stringify(tokensFor("legacy")));
    expect(
      await store.get(oauthIdpSecretServerId(ISSUER), IDP_SESSION_FIELD),
    ).toBe(JSON.stringify({ tokens: tokensFor("idp") }));
    const parsed = JSON.parse(readFileSync(fileA, "utf8")) as Record<
      string,
      unknown
    >;
    expect(parsed[SECRETS_NAMESPACE_KEY]).toBeUndefined();
  });

  it("removing a still-legacy profile purges the shared legacy ids — deliberately", async () => {
    // A pre-namespace file's live index IS the shared legacy ids, and the
    // file being deleted is the store's only index of them: skipping the
    // purge would strand credentials in the shared store with nothing left
    // able to find or clear them. So removal keeps the pre-namespace
    // world's semantics — another still-legacy profile sharing the server
    // re-authorizes once, the same cost it pays when a sibling adopts.
    // Isolation on removal is a property of *stamped* files (covered
    // above), not a retroactive one.
    const store = new InMemorySecretStore();
    await seedLegacy(store);

    await removeOAuthStore(fileA, store);

    expect(
      await store.get(oauthSecretServerId(SERVER), LEGACY_TOKENS_FIELD),
    ).toBeNull();
    expect(
      await store.get(oauthIdpSecretServerId(ISSUER), IDP_SESSION_FIELD),
    ).toBeNull();
    expect(() => readFileSync(fileA, "utf8")).toThrow();
  });
});

describe("namespace ledger: superseded namespaces are purged (#2560)", () => {
  const OTHER = "https://other.example/mcp";

  /**
   * What a ≤ 2.9.x save leaves behind: the same entries, no stamp. `drop`
   * also removes servers, as the old version may have in the meantime.
   */
  async function stripStamp(filePath: string, drop: string[] = []) {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
      servers: Record<string, unknown>;
    } & Record<string, unknown>;
    delete parsed[SECRETS_NAMESPACE_KEY];
    for (const url of drop) delete parsed.servers[url];
    await writeStoreFile(filePath, JSON.stringify(parsed));
    await flushStoreFileWrites(filePath);
  }

  function ledgerNamespaces(filePath: string): string[] {
    const parsed = JSON.parse(
      readFileSync(namespaceLedgerPath(filePath), "utf8"),
    ) as { namespaces: Record<string, unknown> };
    return Object.keys(parsed.namespaces);
  }

  /** Save once, strip the stamp, save again: the alternating-versions cycle. */
  async function alternate(store: SecretStore, drop: string[] = []) {
    await writeOAuthSections(
      fileA,
      {
        servers: {
          [SERVER]: { scope: "read", tokens: tokensFor("one") },
          [OTHER]: { scope: "read", tokens: tokensFor("other") },
        },
        idpSessions: {},
      },
      undefined,
      store,
    );
    await flushStoreFileWrites(fileA);
    const ns1 = namespaceOf(fileA);
    expect(ledgerNamespaces(fileA)).toEqual([ns1]);

    await stripStamp(fileA, drop);
    await writeOAuthSections(
      fileA,
      { servers: { [SERVER]: { scope: "write" } }, idpSessions: {} },
      { servers: [SERVER] },
      store,
    );
    await flushStoreFileWrites(fileA);
    const ns2 = namespaceOf(fileA);
    expect(ns2).not.toBe(ns1);
    return { ns1, ns2 };
  }

  it("re-adoption purges the stripped namespace's entries and drops it from the ledger", async () => {
    const store = new InMemorySecretStore();
    const { ns1, ns2 } = await alternate(store);
    expect(
      await store.get(oauthSecretServerId(SERVER, ns1), LEGACY_TOKENS_FIELD),
    ).toBeNull();
    expect(
      await store.get(oauthSecretServerId(OTHER, ns1), LEGACY_TOKENS_FIELD),
    ).toBeNull();
    expect(ledgerNamespaces(fileA)).toEqual([ns2]);
  });

  it("also purges servers the old version removed from the file meanwhile", async () => {
    // The stripped file no longer names OTHER, so only the ledger can.
    const store = new InMemorySecretStore();
    const { ns1 } = await alternate(store, [OTHER]);
    expect(
      await store.get(oauthSecretServerId(OTHER, ns1), LEGACY_TOKENS_FIELD),
    ).toBeNull();
  });

  it("leaves nothing of the stripped namespace in the keychain (acceptance criterion)", async () => {
    const store = new KeyringSecretStore();
    const { ns1 } = await alternate(store);
    const accounts = [...keyringMocks.password.keys()];
    expect(accounts.some((a) => a.includes(ns1))).toBe(false);
  });

  it("purges IdP session entries recorded under a stripped namespace", async () => {
    const store = new InMemorySecretStore();
    await writeOAuthSections(
      fileA,
      {
        servers: {},
        idpSessions: { [ISSUER]: { idToken: "id-1", refreshToken: "rt-1" } },
      },
      undefined,
      store,
    );
    await flushStoreFileWrites(fileA);
    const ns1 = namespaceOf(fileA);
    expect(
      await store.get(oauthIdpSecretServerId(ISSUER, ns1), IDP_SESSION_FIELD),
    ).not.toBeNull();

    await stripStamp(fileA);
    await writeOAuthSections(
      fileA,
      snapshotFor("x"),
      { servers: [SERVER] },
      store,
    );
    await flushStoreFileWrites(fileA);
    expect(
      await store.get(oauthIdpSecretServerId(ISSUER, ns1), IDP_SESSION_FIELD),
    ).toBeNull();
  });

  it("keeps a namespace whose purge failed recorded, and retries it at the next adoption", async () => {
    const store = new InMemorySecretStore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeOAuthSections(fileA, snapshotFor("one"), undefined, store);
    await flushStoreFileWrites(fileA);
    const ns1 = namespaceOf(fileA);
    const id1 = oauthSecretServerId(SERVER, ns1);

    const realDelete = store.deleteAllForServer.bind(store);
    const del = vi
      .spyOn(store, "deleteAllForServer")
      .mockImplementation(async (id) => {
        if (id === id1) throw new Error("keychain locked");
        return realDelete(id);
      });
    await stripStamp(fileA);
    await writeOAuthSections(fileA, snapshotFor("two"), undefined, store);
    await flushStoreFileWrites(fileA);
    const ns2 = namespaceOf(fileA);
    expect(await store.get(id1, LEGACY_TOKENS_FIELD)).not.toBeNull();
    expect(ledgerNamespaces(fileA).sort()).toEqual([ns1, ns2].sort());
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("keychain locked"),
    );

    // Purge works again; the next adoption picks up both stale namespaces.
    del.mockRestore();
    await stripStamp(fileA);
    await writeOAuthSections(fileA, snapshotFor("three"), undefined, store);
    await flushStoreFileWrites(fileA);
    expect(await store.get(id1, LEGACY_TOKENS_FIELD)).toBeNull();
    expect(ledgerNamespaces(fileA)).toEqual([namespaceOf(fileA)]);
  });

  it("removing a stripped file purges the namespace it lost, and the ledger with it", async () => {
    const store = new InMemorySecretStore();
    await writeOAuthSections(fileA, snapshotFor("one"), undefined, store);
    await flushStoreFileWrites(fileA);
    const ns1 = namespaceOf(fileA);
    await stripStamp(fileA);

    await removeOAuthStore(fileA, store);
    expect(
      await store.get(oauthSecretServerId(SERVER, ns1), LEGACY_TOKENS_FIELD),
    ).toBeNull();
    expect(existsSync(namespaceLedgerPath(fileA))).toBe(false);
  });

  it("a state file deleted by hand has its entries purged by the next save", async () => {
    const store = new InMemorySecretStore();
    await writeOAuthSections(fileA, snapshotFor("one"), undefined, store);
    await flushStoreFileWrites(fileA);
    const ns1 = namespaceOf(fileA);
    rmSync(fileA);

    await writeOAuthSections(fileA, snapshotFor("two"), undefined, store);
    await flushStoreFileWrites(fileA);
    expect(
      await store.get(oauthSecretServerId(SERVER, ns1), LEGACY_TOKENS_FIELD),
    ).toBeNull();
  });

  it("does not touch another state file's namespace", async () => {
    const store = new InMemorySecretStore();
    await writeOAuthSections(fileB, snapshotFor("b"), undefined, store);
    await flushStoreFileWrites(fileB);
    const idB = oauthSecretServerId(SERVER, namespaceOf(fileB));

    await alternate(store);
    expect(await store.get(idB, LEGACY_TOKENS_FIELD)).not.toBeNull();
  });
});
