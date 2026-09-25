/**
 * Integration tests for the OAuth secret split at the file boundary
 * (core/auth/node/oauth-persist-file.ts): write-side split + store cleanup,
 * joined reads, lazy migration of pre-split plaintext files, policy
 * enforcement, and store-failure degradation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeOAuthSections,
  readOAuthStore,
  removeOAuthStore,
  resetOAuthSecretStoreWarnings,
} from "@inspector/core/auth/node/oauth-persist-file.js";
import {
  InMemorySecretStore,
  SessionSecretStore,
  type SecretStore,
} from "@inspector/core/auth/node/secret-store.js";
import {
  PERSIST_TOKENS_ENV,
  oauthSecretServerId,
  oauthIdpSecretServerId,
  issuerTokensField,
  issuerClientSecretField,
  LEGACY_TOKENS_FIELD,
  LEGACY_CLIENT_SECRET_FIELD,
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
const TOKENS = {
  access_token: "at",
  token_type: "Bearer",
  refresh_token: "rt",
};

function snapshotWith(
  overrides: Partial<OAuthPersistSnapshot> = {},
): OAuthPersistSnapshot {
  return {
    servers: {
      [SERVER]: {
        scope: "read",
        tokens: { ...TOKENS },
        clientInformation: { client_id: "cid", client_secret: "cs" },
      },
    },
    idpSessions: {},
    ...overrides,
  };
}

let tempDir: string;
let filePath: string;
let savedPolicy: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "inspector-oauth-split-"));
  filePath = join(tempDir, "oauth.json");
  savedPolicy = process.env[PERSIST_TOKENS_ENV];
  delete process.env[PERSIST_TOKENS_ENV];
});

afterEach(() => {
  if (savedPolicy === undefined) delete process.env[PERSIST_TOKENS_ENV];
  else process.env[PERSIST_TOKENS_ENV] = savedPolicy;
  resetPersistTokensPolicyWarnings();
  resetOAuthSecretStoreWarnings();
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

function readRawFile(): OAuthPersistSnapshot {
  return JSON.parse(readFileSync(filePath, "utf8")) as OAuthPersistSnapshot;
}

describe("writeOAuthSections secret split", () => {
  it("writes only residue to the file and secrets to the store", async () => {
    const store = new InMemorySecretStore();
    await writeOAuthSections(filePath, snapshotWith(), undefined, store);
    await flushStoreFileWrites(filePath);

    const raw = readRawFile();
    expect(raw.servers[SERVER]!.scope).toBe("read");
    expect(raw.servers[SERVER]!.tokens).toBeUndefined();
    expect(raw.servers[SERVER]!.clientInformation).toEqual({
      client_id: "cid",
    });
    const id = oauthSecretServerId(SERVER);
    expect(JSON.parse((await store.get(id, LEGACY_TOKENS_FIELD))!)).toEqual(
      TOKENS,
    );
    expect(await store.get(id, LEGACY_CLIENT_SECRET_FIELD)).toBe("cs");

    const joined = await readOAuthStore(filePath, store);
    expect(joined?.servers[SERVER]).toEqual(snapshotWith().servers[SERVER]);
  });

  it("splits IdP sessions and rejoins them on read", async () => {
    const store = new InMemorySecretStore();
    await writeOAuthSections(
      filePath,
      {
        servers: {},
        idpSessions: {
          [ISSUER]: { idToken: "idt", refreshToken: "rt", idTokenExpiresAt: 9 },
        },
      },
      undefined,
      store,
    );
    await flushStoreFileWrites(filePath);

    const raw = readRawFile();
    expect(raw.idpSessions[ISSUER]).toEqual({ idTokenExpiresAt: 9 });
    expect(
      await store.get(oauthIdpSecretServerId(ISSUER), IDP_SESSION_FIELD),
    ).not.toBeNull();

    const joined = await readOAuthStore(filePath, store);
    expect(joined?.idpSessions[ISSUER]).toEqual({
      idToken: "idt",
      refreshToken: "rt",
      idTokenExpiresAt: 9,
    });
  });

  it("deletes store entries when a sectioned write clears the entry", async () => {
    const store = new InMemorySecretStore();
    await writeOAuthSections(filePath, snapshotWith(), undefined, store);
    await writeOAuthSections(
      filePath,
      { servers: {}, idpSessions: {} },
      { servers: [SERVER] },
      store,
    );
    await flushStoreFileWrites(filePath);

    const id = oauthSecretServerId(SERVER);
    expect(await store.get(id, LEGACY_TOKENS_FIELD)).toBeNull();
    expect(await store.get(id, LEGACY_CLIENT_SECRET_FIELD)).toBeNull();
    expect(readRawFile().servers[SERVER]).toBeUndefined();
  });

  it("deletes a removed issuer's store fields (candidates span old and new shapes)", async () => {
    const store = new InMemorySecretStore();
    await writeOAuthSections(
      filePath,
      {
        servers: {
          [SERVER]: {
            byIssuer: {
              [ISSUER]: {
                tokens: { ...TOKENS },
                clientInformation: { client_id: "c", client_secret: "s" },
              },
            },
          },
        },
        idpSessions: {},
      },
      { servers: [SERVER] },
      store,
    );
    const id = oauthSecretServerId(SERVER);
    expect(await store.get(id, issuerTokensField(ISSUER))).not.toBeNull();

    await writeOAuthSections(
      filePath,
      { servers: { [SERVER]: { scope: "read" } }, idpSessions: {} },
      { servers: [SERVER] },
      store,
    );
    expect(await store.get(id, issuerTokensField(ISSUER))).toBeNull();
    expect(await store.get(id, issuerClientSecretField(ISSUER))).toBeNull();
  });

  it("enforces the persist-tokens policy and self-cleans on downgrade", async () => {
    const store = new InMemorySecretStore();
    const id = oauthSecretServerId(SERVER);

    process.env[PERSIST_TOKENS_ENV] = "access";
    await writeOAuthSections(filePath, snapshotWith(), undefined, store);
    expect(JSON.parse((await store.get(id, LEGACY_TOKENS_FIELD))!)).toEqual({
      access_token: "at",
      token_type: "Bearer",
    });

    process.env[PERSIST_TOKENS_ENV] = "none";
    await writeOAuthSections(filePath, snapshotWith(), undefined, store);
    expect(await store.get(id, LEGACY_TOKENS_FIELD)).toBeNull();
    // Client secrets are registration credentials, not acquired tokens.
    expect(await store.get(id, LEGACY_CLIENT_SECRET_FIELD)).toBe("cs");
  });

  it("deletes an IdP session's store entry when a sectioned write clears it", async () => {
    const store = new InMemorySecretStore();
    await writeOAuthSections(
      filePath,
      { servers: {}, idpSessions: { [ISSUER]: { idToken: "idt" } } },
      undefined,
      store,
    );
    const id = oauthIdpSecretServerId(ISSUER);
    expect(await store.get(id, IDP_SESSION_FIELD)).not.toBeNull();

    // Sections naming only idpSessions also exercises the servers-omitted
    // side of a partial descriptor.
    await writeOAuthSections(
      filePath,
      { servers: {}, idpSessions: {} },
      { idpSessions: [ISSUER] },
      store,
    );
    await flushStoreFileWrites(filePath);
    expect(await store.get(id, IDP_SESSION_FIELD)).toBeNull();
    expect(readRawFile().idpSessions[ISSUER]).toBeUndefined();
  });

  it("stringifies a non-Error store failure in the warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: SecretStore = {
      get: async () => null,
      set: async () => {
        throw "not an Error object";
      },
      delete: async () => {},
      deleteAllForServer: async () => {},
    };
    await writeOAuthSections(filePath, snapshotWith(), undefined, failing);
    expect(
      warn.mock.calls.some(([msg]) =>
        String(msg).includes("not an Error object"),
      ),
    ).toBe(true);
  });

  it("degrades to memory-only with one warning when the store write fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: SecretStore = {
      get: async () => null,
      set: async () => {
        throw new Error("keychain says no");
      },
      delete: async () => {},
      deleteAllForServer: async () => {},
    };
    await writeOAuthSections(filePath, snapshotWith(), undefined, failing);
    await writeOAuthSections(filePath, snapshotWith(), undefined, failing);
    await flushStoreFileWrites(filePath);

    // The residue file is still written — never with the secrets in it.
    const raw = readRawFile();
    expect(raw.servers[SERVER]!.scope).toBe("read");
    expect(raw.servers[SERVER]!.tokens).toBeUndefined();
    const failures = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("keychain says no"),
    );
    expect(failures).toHaveLength(1);

    resetOAuthSecretStoreWarnings();
    await writeOAuthSections(filePath, snapshotWith(), undefined, failing);
    expect(
      warn.mock.calls.filter(([msg]) =>
        String(msg).includes("keychain says no"),
      ),
    ).toHaveLength(2);
  });

  it("rolls back a new entry's store secrets when the file write fails", async () => {
    // The file is the only index of the store's entries: if the residue
    // write fails after the store writes committed, a brand-new server's
    // secrets would be stranded where removeOAuthStore can never find
    // them. Force the write to fail by making the parent path a file.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    void warn; // silence the unlocked-write warning for the blocked path
    const blocker = join(tempDir, "blocker");
    writeFileSync(blocker, "not a directory");
    const blockedPath = join(blocker, "oauth.json");
    const store = new InMemorySecretStore();

    await expect(
      writeOAuthSections(blockedPath, snapshotWith(), undefined, store),
    ).rejects.toThrow();

    // The store writes were rolled back — nothing stranded.
    expect(
      await store.get(oauthSecretServerId(SERVER), LEGACY_TOKENS_FIELD),
    ).toBeNull();
    expect(
      await store.get(oauthSecretServerId(SERVER), LEGACY_CLIENT_SECRET_FIELD),
    ).toBeNull();
  });

  it("restores an indexed entry's prior store secrets when the file write fails", async () => {
    // An already-indexed entry is not rolled back by deletion — its old
    // residue is still on disk, so the store must be restored to the *old*
    // values or the next read joins the old residue (e.g. the previous
    // client_id) with the new secrets. Force the second write to fail by
    // making the directory read-only after the first commit.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    void warn; // silence the unlocked-write warning for the read-only dir
    const store = new InMemorySecretStore();
    await writeOAuthSections(filePath, snapshotWith(), undefined, store);
    await flushStoreFileWrites(filePath);

    const updated = snapshotWith();
    updated.servers[SERVER]!.tokens = {
      ...TOKENS,
      access_token: "at2",
      refresh_token: "rt2",
    };
    updated.servers[SERVER]!.clientInformation = {
      client_id: "cid2",
      client_secret: "cs2",
    };

    chmodSync(tempDir, 0o555);
    try {
      await expect(
        writeOAuthSections(filePath, updated, undefined, store),
      ).rejects.toThrow();
    } finally {
      chmodSync(tempDir, 0o755);
    }

    // The store holds the *old* secrets again, matching the old residue
    // still on disk — no cid/cs2 mismatch on the next joined read.
    const id = oauthSecretServerId(SERVER);
    expect(JSON.parse((await store.get(id, LEGACY_TOKENS_FIELD))!)).toEqual(
      TOKENS,
    );
    expect(await store.get(id, LEGACY_CLIENT_SECRET_FIELD)).toBe("cs");
    const joined = await readOAuthStore(filePath, store);
    expect(joined?.servers[SERVER]).toEqual(snapshotWith().servers[SERVER]);
  });

  it("deduplicates sections: rollback restores the true prior value", async () => {
    // A duplicated URL would make the second pass snapshot the value the
    // first pass just wrote, and a rollback would then finish by
    // "restoring" that intermediate value over the real prior one.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    void warn; // silence the unlocked-write warning for the read-only dir
    const store = new InMemorySecretStore();
    await writeOAuthSections(filePath, snapshotWith(), undefined, store);
    await flushStoreFileWrites(filePath);

    const updated = snapshotWith();
    updated.servers[SERVER]!.clientInformation = {
      client_id: "cid",
      client_secret: "cs2",
    };

    chmodSync(tempDir, 0o555);
    try {
      await expect(
        writeOAuthSections(
          filePath,
          updated,
          { servers: [SERVER, SERVER], idpSessions: [] },
          store,
        ),
      ).rejects.toThrow();
    } finally {
      chmodSync(tempDir, 0o755);
    }

    expect(
      await store.get(oauthSecretServerId(SERVER), LEGACY_CLIENT_SECRET_FIELD),
    ).toBe("cs");
  });

  it("aborts the write when a store delete fails, keeping the old residue", async () => {
    const store = new InMemorySecretStore();
    await writeOAuthSections(filePath, snapshotWith(), undefined, store);
    await flushStoreFileWrites(filePath);

    // Same store contents, but deletes now fail (keychain went away).
    const failingDelete: SecretStore = {
      get: (id, f) => store.get(id, f),
      set: (id, f, v) => store.set(id, f, v),
      delete: async () => {
        throw new Error("keychain unavailable");
      },
      deleteAllForServer: async () => {
        throw new Error("keychain unavailable");
      },
    };

    // Clear the tokens: the split produces no `tokens` secret, so the
    // write must delete the store copy — if that fails, committing the
    // residue would let the next read resurrect the cleared tokens.
    const cleared: OAuthPersistSnapshot = {
      servers: {
        [SERVER]: {
          scope: "read",
          clientInformation: { client_id: "cid", client_secret: "cs" },
        },
      },
      idpSessions: {},
    };
    await expect(
      writeOAuthSections(
        filePath,
        cleared,
        { servers: [SERVER] },
        failingDelete,
      ),
    ).rejects.toThrow("keychain unavailable");

    // Entry removal (purge) failures abort too, for the same reason.
    await expect(
      writeOAuthSections(
        filePath,
        { servers: {}, idpSessions: {} },
        { servers: [SERVER] },
        failingDelete,
      ),
    ).rejects.toThrow("keychain unavailable");
  });

  it("persists and rejoins entries keyed __proto__ instead of dropping them", async () => {
    // Server URLs and issuers are attacker-influenceable map keys. A plain
    // assignment while building residue would hit the prototype setter:
    // the write reports success, the secrets land in the store, but the
    // file serializes no entry — unindexed credentials.
    const store = new InMemorySecretStore();
    const snapshot: OAuthPersistSnapshot = {
      servers: JSON.parse(
        JSON.stringify({
          x: {
            scope: "read",
            tokens: { ...TOKENS },
            clientInformation: { client_id: "cid", client_secret: "cs" },
          },
        }).replace('"x"', '"__proto__"'),
      ),
      idpSessions: JSON.parse('{"__proto__": {"idToken": "idt"}}'),
    };
    await writeOAuthSections(
      filePath,
      snapshot,
      { servers: ["__proto__"], idpSessions: ["__proto__"] },
      store,
    );
    await flushStoreFileWrites(filePath);

    const raw = readRawFile();
    expect(Object.hasOwn(raw.servers, "__proto__")).toBe(true);
    expect(Object.hasOwn(raw.idpSessions, "__proto__")).toBe(true);

    const joined = await readOAuthStore(filePath, store);
    const entry = Object.entries(joined!.servers).find(
      ([url]) => url === "__proto__",
    )?.[1];
    expect(entry?.tokens).toEqual(TOKENS);
    expect(entry?.clientInformation?.client_secret).toBe("cs");
  });
});

describe("readOAuthStore migration", () => {
  it("migrates with policy `all`: existing tokens are moved, not destroyed", async () => {
    // The persist-tokens policy is write-side. Migration relocates
    // already-persisted credentials; under `none` it must not silently
    // destroy them on the first read (the next save applies the policy).
    process.env[PERSIST_TOKENS_ENV] = "none";
    await writeStoreFile(filePath, JSON.stringify(snapshotWith()));
    await flushStoreFileWrites(filePath);
    const store = new InMemorySecretStore();

    const snapshot = await readOAuthStore(filePath, store);
    expect(snapshot?.servers[SERVER]!.tokens).toEqual(TOKENS);
    expect(readRawFile().servers[SERVER]!.tokens).toBeUndefined();
    const raw = await store.get(
      oauthSecretServerId(SERVER),
      LEGACY_TOKENS_FIELD,
    );
    expect(JSON.parse(raw!)).toEqual(TOKENS);
  });

  it("migration keeps refresh tokens under policy `access`", async () => {
    process.env[PERSIST_TOKENS_ENV] = "access";
    await writeStoreFile(filePath, JSON.stringify(snapshotWith()));
    await flushStoreFileWrites(filePath);
    const store = new InMemorySecretStore();

    const snapshot = await readOAuthStore(filePath, store);
    expect(snapshot?.servers[SERVER]!.tokens).toEqual(TOKENS);
  });

  it("migration is store-wins: an existing store value is not overwritten", async () => {
    // The store can legitimately be ahead of a plaintext file (a newer
    // write whose residue commit failed, a restored file backup) — copying
    // the plaintext over it would roll credentials back. Mirror the
    // mcp.json/client.json migrations: copy only where the store is empty.
    await writeStoreFile(filePath, JSON.stringify(snapshotWith()));
    await flushStoreFileWrites(filePath);
    const store = new InMemorySecretStore();
    const id = oauthSecretServerId(SERVER);
    const newerTokens = { ...TOKENS, access_token: "newer-at" };
    await store.set(id, LEGACY_TOKENS_FIELD, JSON.stringify(newerTokens));

    const snapshot = await readOAuthStore(filePath, store);

    // The newer store tokens survive; the plaintext client secret (absent
    // from the store) is still migrated; the file is stripped either way.
    expect(JSON.parse((await store.get(id, LEGACY_TOKENS_FIELD))!)).toEqual(
      newerTokens,
    );
    expect(await store.get(id, LEGACY_CLIENT_SECRET_FIELD)).toBe("cs");
    expect(readRawFile().servers[SERVER]!.tokens).toBeUndefined();
    expect(snapshot?.servers[SERVER]!.tokens).toEqual(newerTokens);
  });

  it("migrates a plaintext file into a durable store on read", async () => {
    await writeStoreFile(filePath, JSON.stringify(snapshotWith()));
    await flushStoreFileWrites(filePath);
    const store = new InMemorySecretStore();

    const snapshot = await readOAuthStore(filePath, store);
    expect(snapshot?.servers[SERVER]).toEqual(snapshotWith().servers[SERVER]);

    const raw = readRawFile();
    expect(raw.servers[SERVER]!.tokens).toBeUndefined();
    expect(raw.servers[SERVER]!.clientInformation).toEqual({
      client_id: "cid",
    });
    expect(
      await store.get(oauthSecretServerId(SERVER), LEGACY_TOKENS_FIELD),
    ).not.toBeNull();
  });

  it("migrates plaintext IdP sessions too", async () => {
    await writeStoreFile(
      filePath,
      JSON.stringify({
        servers: {},
        idpSessions: { [ISSUER]: { idToken: "idt", idTokenExpiresAt: 3 } },
      }),
    );
    await flushStoreFileWrites(filePath);
    const store = new InMemorySecretStore();

    const snapshot = await readOAuthStore(filePath, store);
    expect(snapshot?.idpSessions[ISSUER]).toEqual({
      idToken: "idt",
      idTokenExpiresAt: 3,
    });
    expect(readRawFile().idpSessions[ISSUER]).toEqual({ idTokenExpiresAt: 3 });
  });

  it("leaves a plaintext file untouched when the store is not durable", async () => {
    await writeStoreFile(filePath, JSON.stringify(snapshotWith()));
    await flushStoreFileWrites(filePath);
    const store = new SessionSecretStore();

    const snapshot = await readOAuthStore(filePath, store);
    expect(snapshot?.servers[SERVER]!.tokens).toEqual(TOKENS);
    expect(readRawFile().servers[SERVER]!.tokens).toEqual(TOKENS);
  });

  it("keeps unchanged plaintext secrets durable when a non-durable store writes the entry", async () => {
    // The read-side guard alone is not enough: a mutation of an unrelated
    // field (here: scope) flows the joined entry back through the write
    // split, and an unconditional strip would demote the file's only
    // durable token copy to memory-only.
    await writeStoreFile(filePath, JSON.stringify(snapshotWith()));
    await flushStoreFileWrites(filePath);
    const store = new SessionSecretStore();

    const joined = await readOAuthStore(filePath, store);
    const mutated: OAuthPersistSnapshot = {
      servers: {
        [SERVER]: { ...joined!.servers[SERVER]!, scope: "read write" },
      },
      idpSessions: {},
    };
    await writeOAuthSections(filePath, mutated, { servers: [SERVER] }, store);
    await flushStoreFileWrites(filePath);

    const raw = readRawFile();
    expect(raw.servers[SERVER]!.scope).toBe("read write");
    // Unchanged secrets stay in the file — still the only durable copy.
    expect(raw.servers[SERVER]!.tokens).toEqual(TOKENS);
    expect(raw.servers[SERVER]!.clientInformation).toEqual({
      client_id: "cid",
      client_secret: "cs",
    });
  });

  it("keeps new or changed secrets session-only under a non-durable store", async () => {
    await writeStoreFile(filePath, JSON.stringify(snapshotWith()));
    await flushStoreFileWrites(filePath);
    const store = new SessionSecretStore();

    const reauthed: OAuthPersistSnapshot = {
      servers: {
        [SERVER]: {
          scope: "read",
          tokens: { access_token: "at2", token_type: "Bearer" },
          clientInformation: { client_id: "cid", client_secret: "cs" },
        },
      },
      idpSessions: {},
    };
    await writeOAuthSections(filePath, reauthed, { servers: [SERVER] }, store);
    await flushStoreFileWrites(filePath);

    const raw = readRawFile();
    // The changed tokens are session-only (memory-store contract) …
    expect(raw.servers[SERVER]!.tokens).toBeUndefined();
    // … while the unchanged client secret stays durable in the file.
    expect(raw.servers[SERVER]!.clientInformation).toEqual({
      client_id: "cid",
      client_secret: "cs",
    });
    const joined = await readOAuthStore(filePath, store);
    expect(joined?.servers[SERVER]!.tokens).toEqual({
      access_token: "at2",
      token_type: "Bearer",
    });
  });

  it("compares with the active policy: `access` keeps the unchanged access token durable", async () => {
    process.env[PERSIST_TOKENS_ENV] = "access";
    await writeStoreFile(filePath, JSON.stringify(snapshotWith()));
    await flushStoreFileWrites(filePath);
    const store = new SessionSecretStore();

    const joined = await readOAuthStore(filePath, store);
    const mutated: OAuthPersistSnapshot = {
      servers: {
        [SERVER]: { ...joined!.servers[SERVER]!, scope: "read write" },
      },
      idpSessions: {},
    };
    await writeOAuthSections(filePath, mutated, { servers: [SERVER] }, store);
    await flushStoreFileWrites(filePath);

    // The raw disk blob still carried its refresh token while the split
    // never does under `access` — the compare must be policy-to-policy or
    // the unchanged access token would be wrongly treated as changed and
    // stripped from the only durable copy.
    const raw = readRawFile();
    expect(raw.servers[SERVER]!.tokens).toEqual({
      access_token: "at",
      token_type: "Bearer",
    });
  });

  it("preserves an unchanged plaintext IdP session under a non-durable store", async () => {
    const session = { idToken: "idt", refreshToken: "idprt" };
    await writeStoreFile(
      filePath,
      JSON.stringify({
        servers: {},
        idpSessions: { [ISSUER]: { ...session, idTokenExpiresAt: 1 } },
      }),
    );
    await flushStoreFileWrites(filePath);
    const store = new SessionSecretStore();

    const joined = await readOAuthStore(filePath, store);
    const mutated: OAuthPersistSnapshot = {
      servers: {},
      idpSessions: {
        [ISSUER]: { ...joined!.idpSessions[ISSUER]!, idTokenExpiresAt: 2 },
      },
    };
    await writeOAuthSections(
      filePath,
      mutated,
      { idpSessions: [ISSUER] },
      store,
    );
    await flushStoreFileWrites(filePath);

    const raw = readRawFile();
    expect(raw.idpSessions[ISSUER]).toMatchObject({
      ...session,
      idTokenExpiresAt: 2,
    });
  });

  it("aborts the strip when the store write fails, keeping the plaintext usable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeStoreFile(filePath, JSON.stringify(snapshotWith()));
    await flushStoreFileWrites(filePath);
    const failing: SecretStore = {
      get: async () => null,
      set: async () => {
        throw new Error("store down");
      },
      delete: async () => {},
      deleteAllForServer: async () => {},
    };

    const snapshot = await readOAuthStore(filePath, failing);
    expect(snapshot?.servers[SERVER]!.tokens).toEqual(TOKENS);
    expect(readRawFile().servers[SERVER]!.tokens).toEqual(TOKENS);
    expect(
      warn.mock.calls.some(([msg]) => String(msg).includes("store down")),
    ).toBe(true);
  });

  it("returns null for a missing file", async () => {
    expect(await readOAuthStore(filePath, new InMemorySecretStore())).toBe(
      null,
    );
  });

  it("uses the selected default store when none is injected", async () => {
    // The vitest config pins MCP_INSPECTOR_SECRET_STORE=memory, so the
    // default-parameter paths resolve to the in-process memory store — this
    // covers the write/read/remove signatures the CLI uses.
    await writeOAuthSections(filePath, snapshotWith());
    const snapshot = await readOAuthStore(filePath);
    expect(snapshot?.servers[SERVER]!.tokens).toEqual(TOKENS);
    await removeOAuthStore(filePath);
    expect(existsSync(filePath)).toBe(false);
  });

  it("tolerates a getMany that omits a requested server id", async () => {
    const store = new InMemorySecretStore();
    await writeOAuthSections(
      filePath,
      snapshotWith({ idpSessions: { [ISSUER]: { idToken: "idt" } } }),
      undefined,
      store,
    );
    const withEmptyGetMany: SecretStore = {
      get: async () => null,
      getMany: async () => ({}),
      set: async () => {},
      delete: async () => {},
      deleteAllForServer: async () => {},
    };
    const snapshot = await readOAuthStore(filePath, withEmptyGetMany);
    expect(snapshot?.servers[SERVER]).toEqual({
      scope: "read",
      clientInformation: { client_id: "cid" },
    });
    expect(snapshot?.idpSessions[ISSUER]).toEqual({});
  });

  it("skips the strip when the locked re-read no longer has plaintext", async () => {
    await writeStoreFile(filePath, JSON.stringify(snapshotWith()));
    await flushStoreFileWrites(filePath);
    // A store whose durability probe strips the file first — standing in for
    // a concurrent process winning the migration race between the unlocked
    // plaintext check and the locked re-read.
    const inner = new InMemorySecretStore();
    const racing: SecretStore = {
      isDurable: async () => {
        const residue = snapshotWith();
        delete residue.servers[SERVER]!.tokens;
        delete residue.servers[SERVER]!.clientInformation;
        await writeStoreFile(filePath, JSON.stringify(residue));
        await flushStoreFileWrites(filePath);
        return true;
      },
      get: inner.get.bind(inner),
      set: inner.set.bind(inner),
      delete: inner.delete.bind(inner),
      deleteAllForServer: inner.deleteAllForServer.bind(inner),
    };
    const snapshot = await readOAuthStore(filePath, racing);
    // Nothing was migrated by *this* read; the residue is served as-is.
    expect(snapshot?.servers[SERVER]).toEqual({ scope: "read" });
  });
});

describe("removeOAuthStore", () => {
  it("purges every store entry the file indexes, then deletes the file", async () => {
    const store = new InMemorySecretStore();
    await writeOAuthSections(
      filePath,
      snapshotWith({
        idpSessions: { [ISSUER]: { idToken: "idt" } },
      }),
      undefined,
      store,
    );
    await flushStoreFileWrites(filePath);

    await removeOAuthStore(filePath, store);
    expect(existsSync(filePath)).toBe(false);
    expect(
      await store.get(oauthSecretServerId(SERVER), LEGACY_TOKENS_FIELD),
    ).toBeNull();
    expect(
      await store.get(oauthIdpSecretServerId(ISSUER), IDP_SESSION_FIELD),
    ).toBeNull();
  });

  it("propagates a failed purge and leaves the file as the index", async () => {
    const store = new InMemorySecretStore();
    await writeOAuthSections(filePath, snapshotWith(), undefined, store);
    await flushStoreFileWrites(filePath);

    const failingPurge: SecretStore = {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
      deleteAllForServer: async () => {
        throw new Error("purge failed");
      },
    };
    await expect(removeOAuthStore(filePath, failingPurge)).rejects.toThrow(
      "purge failed",
    );
    // The file is the only index of the store entries — deleting it after
    // a failed purge would strand credentials the next attempt can't find.
    expect(existsSync(filePath)).toBe(true);
  });

  it("restores already-purged entries when a later purge fails", async () => {
    const store = new InMemorySecretStore();
    await writeOAuthSections(
      filePath,
      snapshotWith({ idpSessions: { [ISSUER]: { idToken: "idt" } } }),
      undefined,
      store,
    );
    await flushStoreFileWrites(filePath);

    // Servers are purged first, IdP sessions second: fail the second purge.
    let purges = 0;
    const failingSecond: SecretStore = {
      get: (id, f) => store.get(id, f),
      set: (id, f, v) => store.set(id, f, v),
      delete: (id, f) => store.delete(id, f),
      deleteAllForServer: async (id) => {
        purges += 1;
        if (purges === 2) throw new Error("keychain went away");
        await store.deleteAllForServer(id);
      },
    };

    await expect(removeOAuthStore(filePath, failingSecond)).rejects.toThrow(
      "keychain went away",
    );
    expect(existsSync(filePath)).toBe(true);
    // The first target's purged secrets were restored — a retry of the
    // removal (or a plain read) still finds everything the file indexes.
    expect(
      JSON.parse(
        (await store.get(oauthSecretServerId(SERVER), LEGACY_TOKENS_FIELD))!,
      ),
    ).toEqual(TOKENS);
    expect(
      await store.get(oauthIdpSecretServerId(ISSUER), IDP_SESSION_FIELD),
    ).not.toBeNull();
  });

  it("restores purged secrets when the file delete fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    void warn; // silence the unlocked-write warning for the read-only dir
    const store = new InMemorySecretStore();
    await writeOAuthSections(filePath, snapshotWith(), undefined, store);
    await flushStoreFileWrites(filePath);

    chmodSync(tempDir, 0o555);
    try {
      await expect(removeOAuthStore(filePath, store)).rejects.toThrow();
    } finally {
      chmodSync(tempDir, 0o755);
    }

    // The file survives as the index and the store matches it again.
    expect(existsSync(filePath)).toBe(true);
    expect(
      JSON.parse(
        (await store.get(oauthSecretServerId(SERVER), LEGACY_TOKENS_FIELD))!,
      ),
    ).toEqual(TOKENS);
    expect(
      await store.get(oauthSecretServerId(SERVER), LEGACY_CLIENT_SECRET_FIELD),
    ).toBe("cs");
  });

  it("is a no-op purge for a missing file", async () => {
    await expect(
      removeOAuthStore(filePath, new InMemorySecretStore()),
    ).resolves.toBeUndefined();
    expect(existsSync(filePath)).toBe(false);
  });
});
