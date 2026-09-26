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
  beforeRead: undefined as ((path: string) => void) | undefined,
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
    readStoreFile: vi.fn(async (filePath: string) => {
      hook.beforeRead?.(filePath);
      return actual.readStoreFile(filePath);
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
  hook.beforeRead = undefined;
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
  hook.beforeRead = undefined;
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

  it("escalates a retry store failure instead of degrading, restoring pre-operation secrets", async () => {
    // Attempt 1 lands fully but is clobbered by a writer restoring the old
    // file; attempt 2's store write fails. Degrading here would be unsound —
    // the disk entry is no longer the pre-call state the degrade contract
    // pairs with — so the failure escalates into the reconciling exit, which
    // finds the file changed and restores the pre-operation secrets.
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
    hook.afterWrite = async (path) => {
      writeFileSync(path, withOldB);
      // The foreign writer restored the store too: only-delta persistence
      // means the retry issues a store write at all only when the store
      // does not already hold the desired values.
      await realSet(idB, LEGACY_TOKENS_FIELD, oldTokens!);
      await realSet(idB, LEGACY_CLIENT_SECRET_FIELD, "cs-b");
      hook.afterWrite = undefined;
      let failed = false;
      store.set = async (serverId, field, value) => {
        // Fail exactly one set: a degrade's compensating restore would
        // succeed, so only escalation reaches the reconciling exit.
        if (!failed && serverId === idB) {
          failed = true;
          throw new Error("keychain says no");
        }
        return realSet(serverId, field, value);
      };
    };

    await expect(
      writeOAuthSections(
        filePath,
        snapshotOf({ [SERVER_B]: serverState("b2") }),
        { servers: [SERVER_B] },
        store,
      ),
    ).rejects.toThrow(/keychain says no/);

    store.set = realSet;
    expect(await store.get(idB, LEGACY_TOKENS_FIELD)).toBe(oldTokens);
    expect(await store.get(idB, LEGACY_CLIENT_SECRET_FIELD)).toBe("cs-b");
    const read = await readOAuthStore(filePath, store);
    expect(read?.servers[SERVER_B]?.tokens?.access_token).toBe("at-b");
    expect(read?.servers[SERVER_B]?.clientInformation?.client_id).toBe("cid-b");
    warn.mockRestore();
  });

  it("restores the baseline for fields the committed attempt degraded, not a later attempt's writes", async () => {
    // Attempt 1's store write fails, degrading server B back to its old
    // residue; that file write lands but its read-back fails. Attempt 2's
    // store writes succeed, but its file write fails, escalating into the
    // reconciling exit — which confirms the file still holds attempt 1's
    // blob. That blob pairs with the *old* secrets (attempt 1 degraded B),
    // so attempt 2's store writes must be rolled back to the baseline, not
    // left in place under the old residue.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const idB = oauthSecretServerId(SERVER_B);
    await writeOAuthSections(
      filePath,
      snapshotOf({ [SERVER_B]: serverState("b") }),
      { servers: [SERVER_B] },
      store,
    );
    const oldTokens = await store.get(idB, LEGACY_TOKENS_FIELD);
    expect(oldTokens).toContain("at-b");

    const realSet = store.set.bind(store);
    let failNewSets = true;
    store.set = async (serverId, field, value) => {
      // The degrade's own compensating restore (old values) must succeed.
      if (failNewSets && serverId === idB && value.includes("b2"))
        throw new Error("keychain says no");
      return realSet(serverId, field, value);
    };
    let reads = 0;
    hook.beforeRead = () => {
      reads += 1;
      // Read 1: attempt 1's disk read. Read 2: its failing read-back.
      // Read 3: attempt 2's disk read — the store has recovered by now.
      // Read 4: the reconciling exit's confirmation read.
      if (reads === 2) throw new Error("EIO: read failed");
      if (reads === 3) failNewSets = false;
    };
    let writes = 0;
    hook.beforeWrite = () => {
      writes += 1;
      if (writes === 2) throw new Error("disk full");
    };

    await writeOAuthSections(
      filePath,
      snapshotOf({ [SERVER_B]: serverState("b2") }),
      { servers: [SERVER_B] },
      store,
    );

    store.set = realSet;
    // The committed file holds the old residue; the store must pair with
    // it — attempt 2's b2 values must not survive.
    expect(await store.get(idB, LEGACY_TOKENS_FIELD)).toBe(oldTokens);
    expect(await store.get(idB, LEGACY_CLIENT_SECRET_FIELD)).toBe("cs-b");
    const read = await readOAuthStore(filePath, store);
    expect(read?.servers[SERVER_B]?.tokens?.access_token).toBe("at-b");
    warn.mockRestore();
  });

  it("re-applies a committed attempt's writes when a retry's store failure escalates", async () => {
    // Attempt 1 lands fully but its read-back fails; attempt 2's store
    // write fails outright (no degrade on retries) and escalates into the
    // reconciling exit. The file is confirmed to still hold attempt 1's
    // write, so the save is committed: the store is re-pointed at attempt
    // 1's values and the call reports success.
    const idB = oauthSecretServerId(SERVER_B);
    await writeOAuthSections(
      filePath,
      snapshotOf({ [SERVER_B]: serverState("b") }),
      { servers: [SERVER_B] },
      store,
    );

    const realSet = store.set.bind(store);
    let failSets = false;
    store.set = async (serverId, field, value) => {
      if (failSets) throw new Error("keychain flake");
      return realSet(serverId, field, value);
    };
    let reads = 0;
    hook.beforeRead = () => {
      reads += 1;
      // Read 1: attempt 1's disk read. Read 2: its failing read-back.
      // Read 3: attempt 2's disk read — the store starts flaking here.
      // Read 4: the confirmation read — the flake has passed.
      if (reads === 2) throw new Error("EIO: read failed");
      if (reads === 3) failSets = true;
      if (reads === 4) failSets = false;
    };

    await writeOAuthSections(
      filePath,
      snapshotOf({ [SERVER_B]: serverState("b2") }),
      { servers: [SERVER_B] },
      store,
    );

    store.set = realSet;
    expect(await store.get(idB, LEGACY_TOKENS_FIELD)).toContain("at-b2");
    expect(await store.get(idB, LEGACY_CLIENT_SECRET_FIELD)).toBe("cs-b2");
    const read = await readOAuthStore(filePath, store);
    expect(read?.servers[SERVER_B]?.tokens?.access_token).toBe("at-b2");
  });

  it("reports success when the file is confirmed to still hold an unverified write", async () => {
    // Attempt 1's write lands but its read-back fails; attempt 2's disk read
    // fails too (same sick filesystem). The file still holds attempt 1's
    // write, so rolling back only the store would pair committed residue
    // with restored old secrets. The reconciling exit re-reads the file,
    // finds the write, and reports the save as what it is: committed.
    let reads = 0;
    hook.beforeRead = () => {
      reads += 1;
      // Read 1: attempt 1's disk read. Reads 2-3: attempt 1's verifying
      // read-back and attempt 2's disk read, both failing. Read 4: the
      // reconciling exit's confirmation read, which succeeds.
      if (reads === 2 || reads === 3) throw new Error("EIO: read failed");
    };

    await writeOAuthSections(
      filePath,
      snapshotOf({ [SERVER_B]: serverState("b") }),
      { servers: [SERVER_B] },
      store,
    );

    const idB = oauthSecretServerId(SERVER_B);
    expect(await store.get(idB, LEGACY_TOKENS_FIELD)).toContain("at-b");
    expect(await store.get(idB, LEGACY_CLIENT_SECRET_FIELD)).toBe("cs-b");
    const read = await readOAuthStore(filePath, store);
    expect(read?.servers[SERVER_B]?.tokens?.access_token).toBe("at-b");
  });

  it("restores and warns when the unverified write cannot be confirmed either way", async () => {
    // Same as above, but the confirmation read fails too. Nothing can say
    // whether the file holds the write; the store is restored (the bias
    // that cannot strand secrets) and the warning says the file may still
    // hold the interrupted save.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let reads = 0;
    hook.beforeRead = () => {
      reads += 1;
      if (reads >= 2) throw new Error("EIO: read failed");
    };

    await expect(
      writeOAuthSections(
        filePath,
        snapshotOf({ [SERVER_B]: serverState("b") }),
        { servers: [SERVER_B] },
        store,
      ),
    ).rejects.toThrow(/EIO/);

    const idB = oauthSecretServerId(SERVER_B);
    expect(await store.get(idB, LEGACY_TOKENS_FIELD)).toBeNull();
    expect(await store.get(idB, LEGACY_CLIENT_SECRET_FIELD)).toBeNull();
    expect(
      warn.mock.calls.some(([msg]) =>
        String(msg).includes("Could not re-read"),
      ),
    ).toBe(true);
    warn.mockRestore();
  });
});
