/**
 * Degraded-lock gate on legacy namespace adoption (#2549): migrating a
 * legacy file's secret-store entries deletes its sources, so it is only
 * safe under the real cross-process file lock — two unlocked adopters can
 * each observe the other's half-finished move and strand credentials.
 * These tests mock `withSecretFileLock` to simulate the degraded
 * (unlocked) run and assert the save refuses the migration before
 * touching anything, while mint-only adoption (fresh file) and
 * already-stamped files keep saving unlocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every lock in this suite degrades: the body runs, told it is unlocked.
vi.mock("@inspector/core/auth/node/file-lock.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@inspector/core/auth/node/file-lock.js")
    >();
  return {
    ...actual,
    withSecretFileLock: async <T>(
      _filePath: string,
      fn: (locked: boolean) => Promise<T>,
    ): Promise<T> => fn(false),
  };
});

import {
  writeOAuthSections,
  SECRETS_NAMESPACE_KEY,
} from "@inspector/core/auth/node/oauth-persist-file.js";
import {
  InMemorySecretStore,
  SecretStoreUnavailableError,
} from "@inspector/core/auth/node/secret-store.js";
import {
  PERSIST_TOKENS_ENV,
  oauthSecretServerId,
  isValidSecretsNamespace,
  LEGACY_TOKENS_FIELD,
  resetPersistTokensPolicyWarnings,
} from "@inspector/core/auth/node/oauth-secrets.js";
import {
  writeStoreFile,
  flushStoreFileWrites,
} from "@inspector/core/storage/store-io.js";
import type { OAuthPersistSnapshot } from "@inspector/core/auth/oauth-persist.js";

const SERVER = "https://api.example/mcp";
const TOKENS = {
  access_token: "at-legacy",
  token_type: "Bearer",
  refresh_token: "rt-legacy",
};

function snapshotFor(tag: string): OAuthPersistSnapshot {
  return {
    servers: {
      [SERVER]: {
        scope: "read",
        tokens: { access_token: `at-${tag}`, token_type: "Bearer" },
      },
    },
    idpSessions: {},
  };
}

function fileNamespace(filePath: string): string {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<
    string,
    unknown
  >;
  return parsed[SECRETS_NAMESPACE_KEY] as string;
}

let tempDir: string;
let filePath: string;
let store: InMemorySecretStore;
let savedPolicy: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "inspector-oauth-adopt-lock-"));
  filePath = join(tempDir, "oauth.json");
  store = new InMemorySecretStore();
  savedPolicy = process.env[PERSIST_TOKENS_ENV];
  delete process.env[PERSIST_TOKENS_ENV];
});

afterEach(() => {
  if (savedPolicy === undefined) delete process.env[PERSIST_TOKENS_ENV];
  else process.env[PERSIST_TOKENS_ENV] = savedPolicy;
  resetPersistTokensPolicyWarnings();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("legacy adoption under a degraded (unlocked) file lock", () => {
  it("refuses the migration and leaves the file and legacy entries untouched", async () => {
    const legacyBlob = JSON.stringify({
      servers: { [SERVER]: { scope: "read" } },
      idpSessions: {},
    });
    await writeStoreFile(filePath, legacyBlob);
    await flushStoreFileWrites(filePath);
    await store.set(
      oauthSecretServerId(SERVER),
      LEGACY_TOKENS_FIELD,
      JSON.stringify(TOKENS),
    );

    await expect(
      writeOAuthSections(filePath, snapshotFor("new"), undefined, store),
    ).rejects.toThrow(SecretStoreUnavailableError);

    // Nothing moved, nothing stamped: the legacy entry still resolves and
    // the file carries no namespace, so a locked retry migrates cleanly.
    expect(readFileSync(filePath, "utf8")).toBe(legacyBlob);
    expect(
      await store.get(oauthSecretServerId(SERVER), LEGACY_TOKENS_FIELD),
    ).toBe(JSON.stringify(TOKENS));
  });

  it("still mints for a fresh file — nothing to migrate, nothing to lose", async () => {
    await writeOAuthSections(filePath, snapshotFor("fresh"), undefined, store);
    await flushStoreFileWrites(filePath);

    const ns = fileNamespace(filePath);
    expect(isValidSecretsNamespace(ns)).toBe(true);
    expect(
      await store.get(oauthSecretServerId(SERVER, ns), LEGACY_TOKENS_FIELD),
    ).not.toBeNull();
  });

  it("still mints for a recognized but entry-less legacy file", async () => {
    // `{ servers: {}, idpSessions: {} }` indexes no store ids, so there is
    // no destructive race to guard — refusing it would leave users on
    // lock-hostile filesystems unable to save forever.
    await writeStoreFile(
      filePath,
      JSON.stringify({ servers: {}, idpSessions: {} }),
    );
    await flushStoreFileWrites(filePath);

    await writeOAuthSections(filePath, snapshotFor("empty"), undefined, store);
    await flushStoreFileWrites(filePath);

    const ns = fileNamespace(filePath);
    expect(isValidSecretsNamespace(ns)).toBe(true);
    expect(
      await store.get(oauthSecretServerId(SERVER, ns), LEGACY_TOKENS_FIELD),
    ).not.toBeNull();
  });

  it("still saves against an already-stamped file under its namespace", async () => {
    await writeOAuthSections(filePath, snapshotFor("first"), undefined, store);
    await flushStoreFileWrites(filePath);
    const ns = fileNamespace(filePath);

    await writeOAuthSections(filePath, snapshotFor("second"), undefined, store);
    await flushStoreFileWrites(filePath);

    expect(fileNamespace(filePath)).toBe(ns);
    expect(
      JSON.parse(
        (await store.get(
          oauthSecretServerId(SERVER, ns),
          LEGACY_TOKENS_FIELD,
        ))!,
      ),
    ).toMatchObject({ access_token: "at-second" });
  });
});
