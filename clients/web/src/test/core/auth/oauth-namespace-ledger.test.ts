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
} from "@inspector/core/auth/node/oauth-namespace-ledger.js";
import { InMemorySecretStore } from "@inspector/core/auth/node/secret-store.js";
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

function readLedger(): Record<
  string,
  { servers: string[]; idpSessions: string[] }
> {
  return (
    JSON.parse(readFileSync(ledgerFile, "utf8")) as {
      namespaces: Record<string, { servers: string[]; idpSessions: string[] }>;
    }
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
    await recordNamespaceKeys(stateFile, NS1, [SERVER], []);
    await recordNamespaceKeys(stateFile, NS1, ["https://b.example"], [ISSUER]);
    await recordNamespaceKeys(stateFile, NS2, [SERVER], []);
    expect(readLedger()).toEqual({
      [NS1]: { servers: [SERVER, "https://b.example"], idpSessions: [ISSUER] },
      [NS2]: { servers: [SERVER], idpSessions: [] },
    });
  });

  it("does not rewrite the ledger when every key is already recorded", async () => {
    await recordNamespaceKeys(stateFile, NS1, [SERVER], [ISSUER]);
    const before = readFileSync(ledgerFile, "utf8");
    // A sentinel the rewrite would replace.
    writeFileSync(ledgerFile, before.replace("{", "{ "));
    const sentinel = readFileSync(ledgerFile, "utf8");
    await recordNamespaceKeys(stateFile, NS1, [SERVER], [ISSUER]);
    expect(readFileSync(ledgerFile, "utf8")).toBe(sentinel);
  });

  it("warns once per reason instead of throwing when the ledger is unusable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A directory where the ledger should be: every read fails (EISDIR).
    mkdirSync(ledgerFile);
    await expect(
      recordNamespaceKeys(stateFile, NS1, [SERVER], []),
    ).resolves.toBeUndefined();
    await recordNamespaceKeys(stateFile, NS1, [SERVER], []);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(
      "Could not update the OAuth secrets-namespace ledger",
    );
  });

  it("warns with a non-Error rejection's string form", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Purge's per-id failure path receives whatever the store threw.
    await recordNamespaceKeys(stateFile, NS1, [SERVER], []);
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
          "bad+ns": { servers: [SERVER] },
          [NS1]: { servers: [SERVER, 7], idpSessions: "nope" },
          [NS2]: "not-an-object",
        },
      }),
    );
    expect(del.mock.calls.map(([id]) => id)).toEqual([
      oauthSecretServerId(SERVER, NS1),
    ]);
    // Both valid namespaces purged cleanly, so the ledger is gone.
    expect(existsSync(ledgerFile)).toBe(false);
  });
});

describe("purgeSupersededNamespaces", () => {
  async function seed(namespace: string): Promise<void> {
    await recordNamespaceKeys(stateFile, namespace, [SERVER], [ISSUER]);
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
