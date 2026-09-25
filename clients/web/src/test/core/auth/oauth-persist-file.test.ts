/**
 * Unit tests for the file persist backend's lock-failure handling: when the
 * cross-process lock cannot be acquired, `withSecretFileLock` throws a
 * `SecretFileLockHeldError` whose message talks about "the secrets file"
 * (its other caller) — the OAuth write path must rethrow with OAuth wording
 * so the operator looks at the right file, keeping the original as `cause`.
 * The lock is mocked because a genuinely stuck lock takes ~15s of retries.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  KeychainUnavailableError,
  SecretFileLockHeldError,
} from "@inspector/core/auth/node/secret-store.js";

vi.mock("@inspector/core/auth/node/file-lock.js", () => ({
  withSecretFileLock: vi.fn(),
}));

import { withSecretFileLock } from "@inspector/core/auth/node/file-lock.js";
import {
  readOAuthStore,
  removeOAuthStore,
  writeOAuthSections,
} from "@inspector/core/auth/node/oauth-persist-file.js";
import { InMemorySecretStore } from "@inspector/core/auth/node/secret-store.js";

const SNAPSHOT = { servers: {}, idpSessions: {} };

describe("writeOAuthSections lock failures", () => {
  beforeEach(() => {
    vi.mocked(withSecretFileLock).mockReset();
  });

  it("rethrows SecretFileLockHeldError with OAuth wording and cause", async () => {
    const original = new SecretFileLockHeldError(
      "Could not lock the secrets file",
    );
    vi.mocked(withSecretFileLock).mockRejectedValue(original);

    const rejection = writeOAuthSections("/tmp/oauth.json", SNAPSHOT, {
      servers: ["s"],
    });
    await expect(rejection).rejects.toMatchObject({
      message: expect.stringContaining(
        "Could not save OAuth state: the state file at /tmp/oauth.json is locked",
      ),
      cause: original,
    });
    // The subclass must survive the rewording: it is what the HTTP layer
    // maps to a retryable 503 — a plain Error would demote it to a 500.
    await expect(rejection).rejects.toBeInstanceOf(SecretFileLockHeldError);
  });

  it("passes secret-store failures through untouched", async () => {
    // A KeychainUnavailableError thrown inside the locked callback is a
    // store failure, not a lock failure — rewrapping it as "the file is
    // locked" would lose the type the HTTP layer maps to a 503.
    const original = new KeychainUnavailableError(new Error("keychain down"));
    vi.mocked(withSecretFileLock).mockRejectedValue(original);

    await expect(
      writeOAuthSections("/tmp/oauth.json", SNAPSHOT, { servers: ["s"] }),
    ).rejects.toBe(original);
  });

  it("passes other errors through untouched", async () => {
    const original = new Error("disk exploded");
    vi.mocked(withSecretFileLock).mockRejectedValue(original);

    await expect(
      writeOAuthSections("/tmp/oauth.json", SNAPSHOT, { servers: ["s"] }),
    ).rejects.toBe(original);
  });
});

describe("removeOAuthStore lock failures", () => {
  beforeEach(() => {
    vi.mocked(withSecretFileLock).mockReset();
  });

  it("runs under the file lock and rethrows lock failures with OAuth wording", async () => {
    const original = new SecretFileLockHeldError(
      "Could not lock the secrets file",
    );
    vi.mocked(withSecretFileLock).mockRejectedValue(original);

    await expect(removeOAuthStore("/tmp/oauth.json")).rejects.toMatchObject({
      message: expect.stringContaining(
        "Could not save OAuth state: the state file at /tmp/oauth.json is locked",
      ),
      cause: original,
    });
    expect(vi.mocked(withSecretFileLock)).toHaveBeenCalledWith(
      "/tmp/oauth.json",
      expect.any(Function),
    );
  });
});

describe("readOAuthStore locking", () => {
  beforeEach(() => {
    vi.mocked(withSecretFileLock).mockReset();
  });

  it("runs the file read and store join under the file lock", async () => {
    // The torn-read guard: an unlocked reader could join a writer's old
    // residue with its already-committed new secrets. The whole read must
    // execute inside the same lock the writers hold.
    vi.mocked(withSecretFileLock).mockImplementation(
      async (_path, fn) => fn() as Promise<never>,
    );

    const result = await readOAuthStore(
      "/tmp/does-not-exist-oauth.json",
      new InMemorySecretStore(),
    );

    expect(result).toBeNull();
    expect(vi.mocked(withSecretFileLock)).toHaveBeenCalledWith(
      "/tmp/does-not-exist-oauth.json",
      expect.any(Function),
    );
  });

  it("rethrows lock failures with read wording, keeping the 503 type", async () => {
    const original = new SecretFileLockHeldError(
      "Could not lock the secrets file",
    );
    vi.mocked(withSecretFileLock).mockRejectedValue(original);

    const rejection = readOAuthStore(
      "/tmp/oauth.json",
      new InMemorySecretStore(),
    );
    await expect(rejection).rejects.toMatchObject({
      message: expect.stringContaining(
        "Could not read OAuth state: the state file at /tmp/oauth.json is locked",
      ),
      cause: original,
    });
    await expect(rejection).rejects.toBeInstanceOf(SecretFileLockHeldError);
  });

  it("passes non-lock read failures through untouched", async () => {
    const original = new KeychainUnavailableError(new Error("keychain down"));
    vi.mocked(withSecretFileLock).mockRejectedValue(original);

    await expect(
      readOAuthStore("/tmp/oauth.json", new InMemorySecretStore()),
    ).rejects.toBe(original);
  });
});
