/**
 * Convergence verification in `writeOAuthSections`
 * (core/auth/node/oauth-persist-file.ts): `withSecretFileLock` deliberately
 * degrades to an unlocked run when its lock directory cannot be created, so
 * the sectioned read-merge-write re-reads the file after writing and
 * re-applies itself when another writer landed in between — the same
 * verify/re-apply pattern as `FileSecretStore.mutateLocked`. These tests
 * simulate the racing writer with a hook that rewrites the file immediately
 * after each `writeStoreFile`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeOAuthSections,
  readOAuthStore,
} from "@inspector/core/auth/node/oauth-persist-file.js";
import {
  InMemorySecretStore,
  SecretStoreUnavailableError,
} from "@inspector/core/auth/node/secret-store.js";
import {
  oauthSecretServerId,
  LEGACY_TOKENS_FIELD,
  LEGACY_CLIENT_SECRET_FIELD,
} from "@inspector/core/auth/node/oauth-secrets.js";
import { writeStoreFile } from "@inspector/core/storage/store-io.js";
import type { OAuthPersistSnapshot } from "@inspector/core/auth/oauth-persist.js";

const hook = vi.hoisted(() => ({
  beforeWrite: undefined as ((path: string, data: string) => void) | undefined,
  afterWrite: undefined as
    | ((path: string, data: string) => void | Promise<void>)
    | undefined,
}));

vi.mock("@inspector/core/storage/store-io.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@inspector/core/storage/store-io.js")
    >();
  return {
    ...actual,
    writeStoreFile: vi.fn(async (filePath: string, data: string) => {
      hook.beforeWrite?.(filePath, data);
      await actual.writeStoreFile(filePath, data);
      await hook.afterWrite?.(filePath, data);
    }),
  };
});

const SERVER_A = "https://a.example/mcp";
const SERVER_B = "https://b.example/mcp";

function serverState(tag: string) {
  return {
    scope: "read",
    tokens: {
      access_token: `at-${tag}`,
      token_type: "Bearer",
      refresh_token: `rt-${tag}`,
    },
    clientInformation: { client_id: `cid-${tag}`, client_secret: `cs-${tag}` },
  };
}

function snapshotOf(
  servers: OAuthPersistSnapshot["servers"],
): OAuthPersistSnapshot {
  return { servers, idpSessions: {} };
}

let tempDir: string;
let filePath: string;
let store: InMemorySecretStore;
/** File bytes holding only server A, as the racing writer would leave them. */
let onlyA: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "inspector-oauth-converge-"));
  filePath = join(tempDir, "oauth.json");
  store = new InMemorySecretStore();
  hook.beforeWrite = undefined;
  hook.afterWrite = undefined;
  vi.mocked(writeStoreFile).mockClear();
  await writeOAuthSections(
    filePath,
    snapshotOf({ [SERVER_A]: serverState("a") }),
    { servers: [SERVER_A] },
    store,
  );
  onlyA = readFileSync(filePath, "utf-8");
});

afterEach(() => {
  hook.beforeWrite = undefined;
  hook.afterWrite = undefined;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("writeOAuthSections convergence verification", () => {
  it("re-applies its sections when another writer lands between write and read-back", async () => {
    let clobbers = 0;
    hook.afterWrite = (path) => {
      // The racing writer's result: a full state file that lacks server B —
      // exactly what an unlocked concurrent read-merge-write would leave.
      if (clobbers++ === 0) writeFileSync(path, onlyA);
    };

    await writeOAuthSections(
      filePath,
      snapshotOf({ [SERVER_B]: serverState("b") }),
      { servers: [SERVER_B] },
      store,
    );

    // Seed + first (clobbered) attempt + converging retry.
    expect(vi.mocked(writeStoreFile)).toHaveBeenCalledTimes(3);
    const read = await readOAuthStore(filePath, store);
    expect(read?.servers[SERVER_A]?.tokens?.access_token).toBe("at-a");
    expect(read?.servers[SERVER_B]?.tokens?.access_token).toBe("at-b");
  });

  it("gives up with a typed, retryable error when the file keeps changing", async () => {
    hook.afterWrite = (path) => writeFileSync(path, onlyA);

    await expect(
      writeOAuthSections(
        filePath,
        snapshotOf({ [SERVER_B]: serverState("b") }),
        { servers: [SERVER_B] },
        store,
      ),
    ).rejects.toThrow(SecretStoreUnavailableError);

    // Seed + five attempts, then the bounded loop reports instead of spinning.
    expect(vi.mocked(writeStoreFile)).toHaveBeenCalledTimes(6);
  });

  it("unwinds a new entry's store secrets when it gives up, so nothing is stranded without a file index", async () => {
    hook.afterWrite = (path) => writeFileSync(path, onlyA);

    await expect(
      writeOAuthSections(
        filePath,
        snapshotOf({ [SERVER_B]: serverState("b") }),
        { servers: [SERVER_B] },
        store,
      ),
    ).rejects.toThrow(/kept overwriting/);

    // Server B never made it into the file, so its secrets must not linger
    // in the store (they would have no index for removeOAuthStore to find).
    const idB = oauthSecretServerId(SERVER_B);
    expect(await store.get(idB, LEGACY_TOKENS_FIELD)).toBeNull();
    expect(await store.get(idB, LEGACY_CLIENT_SECRET_FIELD)).toBeNull();
    // Server A's stored secrets are untouched.
    const idA = oauthSecretServerId(SERVER_A);
    expect(await store.get(idA, LEGACY_TOKENS_FIELD)).not.toBeNull();
    expect(await store.get(idA, LEGACY_CLIENT_SECRET_FIELD)).toBe("cs-a");
  });

  it("restores pre-operation values when a retry attempt itself fails", async () => {
    // Attempt 1 succeeds but is clobbered; attempt 2's file write fails hard.
    // The rollback must not treat attempt 1 as committed: its priors would
    // "restore" the values attempt 1 itself wrote, stranding server B's
    // secrets in the store while the surviving file has no index for them.
    let writes = 0;
    hook.beforeWrite = () => {
      writes += 1;
      if (writes === 2) throw new Error("disk full");
    };
    hook.afterWrite = (path) => {
      if (writes === 1) writeFileSync(path, onlyA);
    };

    await expect(
      writeOAuthSections(
        filePath,
        snapshotOf({ [SERVER_B]: serverState("b") }),
        { servers: [SERVER_B] },
        store,
      ),
    ).rejects.toThrow(/disk full/);

    const idB = oauthSecretServerId(SERVER_B);
    expect(await store.get(idB, LEGACY_TOKENS_FIELD)).toBeNull();
    expect(await store.get(idB, LEGACY_CLIENT_SECRET_FIELD)).toBeNull();
    const idA = oauthSecretServerId(SERVER_A);
    expect(await store.get(idA, LEGACY_CLIENT_SECRET_FIELD)).toBe("cs-a");
    expect(readFileSync(filePath, "utf-8")).toBe(onlyA);
  });

  it("rolls back when a clobbering writer leaves an unrecognized file", async () => {
    // The retry's disk read throws on unrecognized content; that exit must
    // restore the store like any other failure, or the earlier attempt's
    // writes are stranded.
    hook.afterWrite = (path) =>
      writeFileSync(path, JSON.stringify({ hello: "world" }));

    await expect(
      writeOAuthSections(
        filePath,
        snapshotOf({ [SERVER_B]: serverState("b") }),
        { servers: [SERVER_B] },
        store,
      ),
    ).rejects.toThrow(/refusing/i);

    const idB = oauthSecretServerId(SERVER_B);
    expect(await store.get(idB, LEGACY_TOKENS_FIELD)).toBeNull();
    expect(await store.get(idB, LEGACY_CLIENT_SECRET_FIELD)).toBeNull();
    const idA = oauthSecretServerId(SERVER_A);
    expect(await store.get(idA, LEGACY_CLIENT_SECRET_FIELD)).toBe("cs-a");
  });

  it("keeps a concurrent writer's newer value when rolling back", async () => {
    // Blind pre-operation restore would be wrong too: a value a concurrent
    // writer stored between attempts is newer state this call did not write,
    // and rolling it back to the pre-operation value would clobber that
    // writer. The rollback baseline folds each attempt's priors, telling our
    // own earlier attempt's writes (equal to what this call writes — they
    // are constant across attempts) apart from foreign values.
    const idB = oauthSecretServerId(SERVER_B);
    await writeOAuthSections(
      filePath,
      snapshotOf({ [SERVER_B]: serverState("b") }),
      { servers: [SERVER_B] },
      store,
    );
    const withOldB = readFileSync(filePath, "utf-8");
    const foreignTokens = JSON.stringify({
      access_token: "at-bF",
      token_type: "Bearer",
    });

    let writes = 0;
    hook.beforeWrite = () => {
      writes += 1;
      if (writes === 2) throw new Error("disk full");
    };
    hook.afterWrite = async (path) => {
      if (writes !== 1) return;
      // The concurrent writer lands after our first attempt: its own store
      // write for server B, and a file replacing ours.
      await store.set(idB, LEGACY_TOKENS_FIELD, foreignTokens);
      writeFileSync(path, withOldB);
    };

    await expect(
      writeOAuthSections(
        filePath,
        snapshotOf({ [SERVER_B]: serverState("b2") }),
        { servers: [SERVER_B] },
        store,
      ),
    ).rejects.toThrow(/disk full/);

    // The foreign value survives the rollback; fields the foreign writer
    // did not touch return to their pre-operation values.
    expect(await store.get(idB, LEGACY_TOKENS_FIELD)).toBe(foreignTokens);
    expect(await store.get(idB, LEGACY_CLIENT_SECRET_FIELD)).toBe("cs-b");
  });

  it("degrading on a retry restores pre-operation secrets, not the failed attempt's own writes", async () => {
    // Attempt 1 lands fully but is clobbered by a writer restoring the old
    // file; attempt 2's store write fails, degrading the entry to
    // memory-only. The degrade keeps the *old* residue in the file, so the
    // restore must put back the *old* secrets — restoring attempt 1's own
    // writes would report success with the new secrets committed under the
    // old residue.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const idB = oauthSecretServerId(SERVER_B);
    await writeOAuthSections(
      filePath,
      snapshotOf({ [SERVER_B]: serverState("b") }),
      { servers: [SERVER_B] },
      store,
    );
    const withOldB = readFileSync(filePath, "utf-8");
    const oldTokens = await store.get(idB, LEGACY_TOKENS_FIELD);
    expect(oldTokens).toContain("at-b");

    const realSet = store.set.bind(store);
    hook.afterWrite = (path) => {
      writeFileSync(path, withOldB);
      hook.afterWrite = undefined;
      store.set = async (serverId, field, value) => {
        // Only the new values fail; the compensating restore must succeed
        // (an unconfirmed compensation aborts the write instead).
        if (serverId === idB && value.includes("b2"))
          throw new Error("keychain says no");
        return realSet(serverId, field, value);
      };
    };

    await writeOAuthSections(
      filePath,
      snapshotOf({ [SERVER_B]: serverState("b2") }),
      { servers: [SERVER_B] },
      store,
    );

    store.set = realSet;
    expect(await store.get(idB, LEGACY_TOKENS_FIELD)).toBe(oldTokens);
    expect(await store.get(idB, LEGACY_CLIENT_SECRET_FIELD)).toBe("cs-b");
    const read = await readOAuthStore(filePath, store);
    expect(read?.servers[SERVER_B]?.tokens?.access_token).toBe("at-b");
    expect(read?.servers[SERVER_B]?.clientInformation?.client_id).toBe("cid-b");
    warn.mockRestore();
  });
});
