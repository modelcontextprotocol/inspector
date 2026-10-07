/**
 * Unit tests for the secrets-namespace ledger (#2560): its tolerant parse,
 * record-only-when-new writes, per-namespace purge bookkeeping, and the
 * best-effort failure handling that keeps a ledger problem from ever
 * failing the OAuth save or removal it rides on. The end-to-end scenarios
 * (a stripped stamp re-adopted, a stripped file removed) live in the
 * integration suite's `oauth-secrets-namespace.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Passthrough, so one test can fail the ledger's write-back on demand.
vi.mock("@inspector/core/storage/store-io.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@inspector/core/storage/store-io.js")
    >();
  return { ...actual, writeStoreFile: vi.fn(actual.writeStoreFile) };
});

import { writeStoreFile } from "@inspector/core/storage/store-io.js";
import {
  namespaceLedgerPath,
  purgeSupersededNamespaces,
  recordNamespaceKeys,
  resetNamespaceLedgerWarnings,
  secretStoreLocation,
} from "@inspector/core/auth/node/oauth-namespace-ledger.js";
import {
  InMemorySecretStore,
  KeyringSecretStore,
  SessionSecretStore,
} from "@inspector/core/auth/node/secret-store.js";
import { FileSecretStore } from "@inspector/core/auth/node/file-secret-store.js";
import {
  defaultSecretStore,
  SECRET_FILE_ENV,
  SECRET_STORE_ENV,
} from "@inspector/core/auth/node/secret-store-selection.js";

/**
 * The keychain, as far as `instanceof` is concerned, backed by a map — the
 * native module is absent in CI.
 */
class FakeKeyring extends KeyringSecretStore {
  readonly deleted: string[] = [];
  async deleteAllForServer(serverId: string): Promise<void> {
    this.deleted.push(serverId);
  }
}
import {
  LEGACY_TOKENS_FIELD,
  IDP_SESSION_FIELD,
  oauthIdpSecretServerId,
  oauthSecretServerId,
} from "@inspector/core/auth/node/oauth-secrets.js";

const NS1 = "11111111-1111-4111-8111-111111111111";
const NS2 = "22222222-2222-4222-8222-222222222222";
const SERVER = "https://api.example/mcp";
const ISSUER = "https://as.example";

let tempDir: string;
let stateFile: string;
let ledgerFile: string;
let store: InMemorySecretStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "inspector-ns-ledger-"));
  stateFile = join(tempDir, "oauth.json");
  ledgerFile = namespaceLedgerPath(stateFile);
  store = new InMemorySecretStore();
});

afterEach(() => {
  resetNamespaceLedgerWarnings();
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

type LedgerJson = Record<
  string,
  Record<string, { servers: string[]; idpSessions: string[] }>
>;

function readLedger(): LedgerJson {
  return (
    JSON.parse(readFileSync(ledgerFile, "utf8")) as { namespaces: LedgerJson }
  ).namespaces;
}

describe("namespaceLedgerPath", () => {
  it("sits beside the state file", () => {
    expect(namespaceLedgerPath("/x/oauth.json")).toBe(
      "/x/oauth.json.namespaces.json",
    );
  });
});

describe("recordNamespaceKeys", () => {
  it("creates the ledger and accumulates keys per namespace", async () => {
    await recordNamespaceKeys(stateFile, store, NS1, [SERVER], []);
    await recordNamespaceKeys(
      stateFile,
      store,
      NS1,
      ["https://b.example"],
      [ISSUER],
    );
    await recordNamespaceKeys(stateFile, store, NS2, [SERVER], []);
    expect(readLedger()).toEqual({
      [NS1]: {
        memory: {
          servers: [SERVER, "https://b.example"],
          idpSessions: [ISSUER],
        },
      },
      [NS2]: { memory: { servers: [SERVER], idpSessions: [] } },
    });
  });

  it("does not rewrite the ledger when every key is already recorded", async () => {
    await recordNamespaceKeys(stateFile, store, NS1, [SERVER], [ISSUER]);
    const before = readFileSync(ledgerFile, "utf8");
    // A sentinel the rewrite would replace: one space after the opening brace.
    writeFileSync(ledgerFile, before.replace(/^\{/, "{ "));
    const sentinel = readFileSync(ledgerFile, "utf8");
    expect(sentinel).not.toBe(before);
    await recordNamespaceKeys(stateFile, store, NS1, [SERVER], [ISSUER]);
    expect(readFileSync(ledgerFile, "utf8")).toBe(sentinel);
  });

  it("warns once per reason instead of throwing when the ledger is unusable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A directory where the ledger should be: every read fails (EISDIR).
    mkdirSync(ledgerFile);
    await expect(
      recordNamespaceKeys(stateFile, store, NS1, [SERVER], []),
    ).resolves.toBeUndefined();
    await recordNamespaceKeys(stateFile, store, NS1, [SERVER], []);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(
      "Could not update the OAuth secrets-namespace ledger",
    );
  });

  it("warns with a non-Error rejection's string form", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Purge's per-id failure path receives whatever the store threw.
    await recordNamespaceKeys(stateFile, store, NS1, [SERVER], []);
    vi.spyOn(store, "deleteAllForServer").mockRejectedValue("plain string");
    await purgeSupersededNamespaces(stateFile, store, undefined);
    expect(warn.mock.calls[0][0]).toContain("(plain string)");
  });
});

describe("tolerant parse", () => {
  async function purgeAllFrom(raw: string): Promise<void> {
    writeFileSync(ledgerFile, raw);
    await purgeSupersededNamespaces(stateFile, store, undefined);
  }

  it.each([
    ["unparseable JSON", "{not json"],
    ["a non-object", "42"],
    ["no namespaces map", JSON.stringify({ other: 1 })],
    ["a non-object namespaces value", JSON.stringify({ namespaces: "x" })],
  ])("reads %s as an empty ledger", async (_label, raw) => {
    const del = vi.spyOn(store, "deleteAllForServer");
    await purgeAllFrom(raw);
    expect(del).not.toHaveBeenCalled();
    // Nothing changed, so the junk is left as found rather than rewritten.
    expect(readFileSync(ledgerFile, "utf8")).toBe(raw);
  });

  it("skips an invalid namespace and non-string keys, never building their ids", async () => {
    const del = vi.spyOn(store, "deleteAllForServer");
    await purgeAllFrom(
      JSON.stringify({
        namespaces: {
          "bad+ns": { memory: { servers: [SERVER] } },
          [NS1]: { memory: { servers: [SERVER, 7], idpSessions: "nope" } },
          [NS2]: "not-an-object",
          "33333333-3333-4333-8333-333333333333": { memory: ["array"] },
        },
      }),
    );
    expect(del.mock.calls.map(([id]) => id)).toEqual([
      oauthSecretServerId(SERVER, NS1),
    ]);
    // Both valid namespaces purged cleanly, so the ledger is gone.
    expect(existsSync(ledgerFile)).toBe(false);
  });

  it("keeps a `__proto__` location an own key through a rewrite", async () => {
    writeFileSync(
      ledgerFile,
      `{"namespaces":{"${NS1}":{"__proto__":{"servers":["${SERVER}"]}},"${NS2}":{"memory":{"servers":["${SERVER}"]}}}}`,
    );
    await purgeSupersededNamespaces(stateFile, store, NS1);
    // NS2 purged and rewritten out; NS1's odd location survives as data.
    expect(
      Object.getOwnPropertyNames(readLedger()[NS1] ?? {}).includes("__proto__"),
    ).toBe(true);
  });
});

describe("secretStoreLocation", () => {
  it("names the keychain, a specific secrets file, or memory", async () => {
    expect(await secretStoreLocation(new KeyringSecretStore())).toBe("keyring");
    expect(
      await secretStoreLocation(
        new FileSecretStore({ filePath: "rel/secrets.json", passphrase: "" }),
      ),
    ).toBe(`file:${join(process.cwd(), "rel/secrets.json")}`);
    expect(await secretStoreLocation(new InMemorySecretStore())).toBe("memory");
    expect(await secretStoreLocation(new SessionSecretStore())).toBe("memory");
  });

  it("names the store a production default resolves to, not the wrapper", async () => {
    // `defaultSecretStore()` is a deferred wrapper; read as-is it would
    // name nothing and every production store would read as `memory`.
    const secretsFile = join(tempDir, "secrets.json");
    const saved = {
      kind: process.env[SECRET_STORE_ENV],
      file: process.env[SECRET_FILE_ENV],
    };
    process.env[SECRET_STORE_ENV] = "file";
    process.env[SECRET_FILE_ENV] = secretsFile;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await secretStoreLocation(defaultSecretStore())).toBe(
        `file:${secretsFile}`,
      );
    } finally {
      for (const [name, value] of [
        [SECRET_STORE_ENV, saved.kind],
        [SECRET_FILE_ENV, saved.file],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe("purgeSupersededNamespaces", () => {
  async function seed(namespace: string): Promise<void> {
    await recordNamespaceKeys(stateFile, store, namespace, [SERVER], [ISSUER]);
    await store.set(
      oauthSecretServerId(SERVER, namespace),
      LEGACY_TOKENS_FIELD,
      "t",
    );
    await store.set(
      oauthIdpSecretServerId(ISSUER, namespace),
      IDP_SESSION_FIELD,
      "s",
    );
  }

  it("purges every namespace but the current one, server and IdP ids alike", async () => {
    await seed(NS1);
    await seed(NS2);
    await purgeSupersededNamespaces(stateFile, store, NS2);
    expect(
      await store.get(oauthSecretServerId(SERVER, NS1), LEGACY_TOKENS_FIELD),
    ).toBeNull();
    expect(
      await store.get(oauthIdpSecretServerId(ISSUER, NS1), IDP_SESSION_FIELD),
    ).toBeNull();
    expect(
      await store.get(oauthSecretServerId(SERVER, NS2), LEGACY_TOKENS_FIELD),
    ).toBe("t");
    expect(Object.keys(readLedger())).toEqual([NS2]);
  });

  it("deletes the ledger once nothing is left recorded", async () => {
    await seed(NS1);
    await purgeSupersededNamespaces(stateFile, store, undefined);
    expect(existsSync(ledgerFile)).toBe(false);
  });

  it("is a no-op without a ledger", async () => {
    const del = vi.spyOn(store, "deleteAllForServer");
    await purgeSupersededNamespaces(stateFile, store, undefined);
    expect(del).not.toHaveBeenCalled();
    expect(existsSync(ledgerFile)).toBe(false);
  });

  it("keeps a namespace recorded when one of its ids fails, still attempting the rest", async () => {
    await seed(NS1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = oauthSecretServerId(SERVER, NS1);
    const realDelete = store.deleteAllForServer.bind(store);
    vi.spyOn(store, "deleteAllForServer").mockImplementation(async (id) => {
      if (id === failing) throw new Error("keychain locked");
      return realDelete(id);
    });
    await purgeSupersededNamespaces(stateFile, store, undefined);
    expect(
      await store.get(oauthIdpSecretServerId(ISSUER, NS1), IDP_SESSION_FIELD),
    ).toBeNull();
    expect(Object.keys(readLedger())).toEqual([NS1]);
    expect(warn.mock.calls[0][0]).toContain("keychain locked");
  });

  it("leaves another location's record for a run that uses that store", async () => {
    // Entries written to the keychain; this run fell back to another
    // store. Deleting there "succeeds" against nothing, so the keychain
    // record must survive for a later keychain run.
    const keyring = new KeyringSecretStore();
    await recordNamespaceKeys(stateFile, keyring, NS1, [SERVER], []);
    const del = vi.spyOn(store, "deleteAllForServer");
    await purgeSupersededNamespaces(stateFile, store, undefined);
    expect(del).not.toHaveBeenCalled();
    expect(readLedger()[NS1]).toEqual({
      keyring: { servers: [SERVER], idpSessions: [] },
    });
  });

  it("from the keychain, also purges a secrets file's records but keeps them", async () => {
    // The hand-off may have copied them in — or may still be copying, or
    // was interrupted — so the keychain run purges and keeps the record
    // for the next save rather than guessing that it is finished.
    const keyring = new FakeKeyring();
    const fileStore = new FileSecretStore({
      filePath: join(tempDir, "secrets.json"),
      passphrase: "",
    });
    await recordNamespaceKeys(stateFile, fileStore, NS1, [SERVER], []);
    await recordNamespaceKeys(stateFile, keyring, NS2, [SERVER], []);

    await purgeSupersededNamespaces(stateFile, keyring, undefined);
    expect(keyring.deleted.sort()).toEqual(
      [
        oauthSecretServerId(SERVER, NS1),
        oauthSecretServerId(SERVER, NS2),
      ].sort(),
    );
    // The keychain's own record is done; the file's record stays.
    expect(readLedger()).toEqual({
      [NS1]: {
        [`file:${fileStore.filePath}`]: { servers: [SERVER], idpSessions: [] },
      },
    });
  });

  it("a secrets file's own purge hands its record to the keychain instead of forgetting it", async () => {
    // Its entries may already have been copied into the keychain by a
    // hand-off, so the keys stay tracked there for a keychain run.
    const fileStore = new FileSecretStore({
      filePath: join(tempDir, "secrets.json"),
      passphrase: "",
    });
    const fileDel = vi
      .spyOn(fileStore, "deleteAllForServer")
      .mockResolvedValue(undefined);
    await recordNamespaceKeys(stateFile, fileStore, NS1, [SERVER], [ISSUER]);
    await recordNamespaceKeys(
      stateFile,
      new FakeKeyring(),
      NS1,
      ["https://b.example"],
      [],
    );

    await purgeSupersededNamespaces(stateFile, fileStore, undefined);
    expect(fileDel).toHaveBeenCalledTimes(2);
    expect(readLedger()).toEqual({
      [NS1]: {
        keyring: {
          servers: ["https://b.example", SERVER],
          idpSessions: [ISSUER],
        },
      },
    });

    const keyring = new FakeKeyring();
    await purgeSupersededNamespaces(stateFile, keyring, undefined);
    expect(existsSync(ledgerFile)).toBe(false);
  });

  it("does not extend a secrets file's or memory run to another file's records", async () => {
    const other = new FileSecretStore({
      filePath: join(tempDir, "other.json"),
      passphrase: "",
    });
    await recordNamespaceKeys(stateFile, other, NS1, [SERVER], []);
    const del = vi.spyOn(store, "deleteAllForServer");
    const mine = new FileSecretStore({
      filePath: join(tempDir, "mine.json"),
      passphrase: "",
    });
    const mineDel = vi.spyOn(mine, "deleteAllForServer");
    await purgeSupersededNamespaces(stateFile, store, undefined);
    await purgeSupersededNamespaces(stateFile, mine, undefined);
    expect(del).not.toHaveBeenCalled();
    expect(mineDel).not.toHaveBeenCalled();
    expect(Object.keys(readLedger())).toEqual([NS1]);
  });

  it("drops only the purged location's record, keeping the namespace for the rest", async () => {
    await seed(NS1);
    await recordNamespaceKeys(
      stateFile,
      new KeyringSecretStore(),
      NS1,
      [SERVER],
      [],
    );
    await purgeSupersededNamespaces(stateFile, store, undefined);
    expect(Object.keys(readLedger()[NS1])).toEqual(["keyring"]);
  });

  it("survives a key whose id cannot be built, purging the rest and keeping the record", async () => {
    // JSON-escaped unpaired surrogate: parses to a string that makes
    // `encodeURIComponent` throw URIError.
    writeFileSync(
      ledgerFile,
      `{"namespaces":{"${NS1}":{"memory":{"servers":["\\ud800","${SERVER}"]}}}}`,
    );
    await store.set(oauthSecretServerId(SERVER, NS1), LEGACY_TOKENS_FIELD, "t");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      purgeSupersededNamespaces(stateFile, store, undefined),
    ).resolves.toBeUndefined();
    expect(
      await store.get(oauthSecretServerId(SERVER, NS1), LEGACY_TOKENS_FIELD),
    ).toBeNull();
    expect(Object.keys(readLedger())).toEqual([NS1]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns and gives up when the ledger cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mkdirSync(ledgerFile);
    const del = vi.spyOn(store, "deleteAllForServer");
    await expect(
      purgeSupersededNamespaces(stateFile, store, undefined),
    ).resolves.toBeUndefined();
    expect(del).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain(
      "Could not read the OAuth secrets-namespace ledger",
    );
  });

  it("warns when the purged ledger cannot be written back", async () => {
    await seed(NS1);
    await seed(NS2);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(writeStoreFile).mockRejectedValueOnce(new Error("disk full"));
    await expect(
      purgeSupersededNamespaces(stateFile, store, NS2),
    ).resolves.toBeUndefined();
    // The purge itself happened; only the bookkeeping is stale.
    expect(
      await store.get(oauthSecretServerId(SERVER, NS1), LEGACY_TOKENS_FIELD),
    ).toBeNull();
    expect(warn.mock.calls.at(-1)?.[0]).toContain(
      "Could not update the OAuth secrets-namespace ledger",
    );
  });
});
