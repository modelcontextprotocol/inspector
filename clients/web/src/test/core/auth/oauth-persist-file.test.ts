/**
 * Unit tests for the file persist backend's lock-failure handling: when the
 * cross-process lock cannot be acquired, `withSecretFileLock` throws a
 * `SecretStoreUnavailableError` whose message talks about "the secrets file"
 * (its other caller) — the OAuth write path must rethrow with OAuth wording
 * so the operator looks at the right file, keeping the original as `cause`.
 * The lock is mocked because a genuinely stuck lock takes ~15s of retries.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SecretStoreUnavailableError } from "@inspector/core/auth/node/secret-store.js";

vi.mock("@inspector/core/auth/node/file-lock.js", () => ({
  withSecretFileLock: vi.fn(),
}));

import { withSecretFileLock } from "@inspector/core/auth/node/file-lock.js";
import {
  removeOAuthStore,
  writeOAuthSections,
} from "@inspector/core/auth/node/oauth-persist-file.js";

const SNAPSHOT = { servers: {}, idpSessions: {} };

describe("writeOAuthSections lock failures", () => {
  beforeEach(() => {
    vi.mocked(withSecretFileLock).mockReset();
  });

  it("rethrows SecretStoreUnavailableError with OAuth wording and cause", async () => {
    const original = new SecretStoreUnavailableError(
      "Could not lock the secrets file",
    );
    vi.mocked(withSecretFileLock).mockRejectedValue(original);

    await expect(
      writeOAuthSections("/tmp/oauth.json", SNAPSHOT, { servers: ["s"] }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        "Could not save OAuth state: the state file at /tmp/oauth.json is locked",
      ),
      cause: original,
    });
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
    const original = new SecretStoreUnavailableError(
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
