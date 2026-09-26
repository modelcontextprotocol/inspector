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
  afterWrite: undefined as ((path: string, data: string) => void) | undefined,
}));

vi.mock("@inspector/core/storage/store-io.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@inspector/core/storage/store-io.js")
    >();
  return {
    ...actual,
    writeStoreFile: vi.fn(async (filePath: string, data: string) => {
      await actual.writeStoreFile(filePath, data);
      hook.afterWrite?.(filePath, data);
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
});
