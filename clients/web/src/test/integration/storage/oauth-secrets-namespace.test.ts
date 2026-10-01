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
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

import {
  writeOAuthSections,
  readOAuthStore,
  resetOAuthSecretStoreWarnings,
  SECRETS_NAMESPACE_KEY,
} from "@inspector/core/auth/node/oauth-persist-file.js";
import {
  InMemorySecretStore,
  KeyringSecretStore,
  type SecretStore,
} from "@inspector/core/auth/node/secret-store.js";
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
});
