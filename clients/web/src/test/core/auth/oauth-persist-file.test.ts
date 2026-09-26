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
import { oauthSecretServerId } from "@inspector/core/auth/node/oauth-secrets.js";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

  it("does not reword a nested secrets-file lock error from inside the callback", async () => {
    // The nested FileSecretStore takes its own lock on secrets.json while
    // this callback runs. If *that* lock is contended, the error escaping
    // here already names the actually-contended file — rewording it as
    // "the state file at …oauth.json is locked" would direct the user at
    // the wrong file. Only acquisition failures (the mocks above, which
    // reject before the callback runs) get the OAuth wording.
    vi.mocked(withSecretFileLock).mockImplementation(
      async (_path, fn) => fn() as Promise<never>,
    );
    const original = new SecretFileLockHeldError(
      "Could not lock the secrets file at /home/u/.mcp-inspector/secrets.json",
    );
    const store = new InMemorySecretStore();
    store.deleteAllForServer = async () => {
      throw original;
    };

    // An empty snapshot with a named section deletes that entry's store
    // fields — the first store mutation the callback makes.
    await expect(
      writeOAuthSections(
        "/tmp/does-not-exist-oauth.json",
        SNAPSHOT,
        { servers: ["https://s.example/mcp"] },
        store,
      ),
    ).rejects.toBe(original);
  });
});

describe("removeOAuthStore lock failures", () => {
  beforeEach(() => {
    vi.mocked(withSecretFileLock).mockReset();
  });

  it("runs under the file lock and rethrows lock failures with remove wording", async () => {
    const original = new SecretFileLockHeldError(
      "Could not lock the secrets file",
    );
    vi.mocked(withSecretFileLock).mockRejectedValue(original);

    await expect(removeOAuthStore("/tmp/oauth.json")).rejects.toMatchObject({
      message: expect.stringContaining(
        "Could not remove OAuth state: the state file at /tmp/oauth.json is locked",
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

describe("persistEntrySecrets partial-commit compensation", () => {
  beforeEach(() => {
    vi.mocked(withSecretFileLock).mockReset();
    vi.mocked(withSecretFileLock).mockImplementation(
      async (_path, fn) => fn() as Promise<never>,
    );
  });

  const url = "https://s.example/mcp";
  const NEW_STATE = {
    tokens: {
      access_token: "new-at",
      refresh_token: "new-rt",
      token_type: "Bearer",
    },
    clientInformation: { client_id: "cid", client_secret: "new-cs" },
  };
  const OLD_TOKENS = JSON.stringify({
    access_token: "old-at",
    token_type: "Bearer",
  });

  /** A store pre-loaded with the entry's prior secrets, whose `set` rejects
   * per `failWhen` — the bulk-set fallback settles siblings before
   * rethrowing, so a selective failure produces a real partial commit. */
  const storeWithFailingSet = async (
    failWhen: (field: string, value: string) => boolean,
  ) => {
    const store = new InMemorySecretStore();
    const serverId = oauthSecretServerId(url);
    await store.set(serverId, "tokens", OLD_TOKENS);
    await store.set(serverId, "client-secret", "old-cs");
    const realSet = store.set.bind(store);
    store.set = async (sid: string, field: string, value: string) => {
      if (failWhen(field, value))
        throw new KeychainUnavailableError(new Error("keychain flaked"));
      return realSet(sid, field, value);
    };
    return { store, serverId };
  };

  it("restores the touched fields after a partial bulk-set commit, then degrades", async () => {
    // One sibling set lands ("tokens") while another fails ("client-secret").
    // Without compensation the store would hold new tokens next to the old
    // client secret — a credential set that was never issued together —
    // joined to the new residue on the next read. The catch must put the
    // touched fields back to their pre-write values and only then continue
    // with the memory-only degradation (residue still committed).
    const { store, serverId } = await storeWithFailingSet(
      (field, value) => field === "client-secret" && value === "new-cs",
    );
    const dir = await mkdtemp(join(tmpdir(), "oauth-persist-partial-"));
    const file = join(dir, "oauth.json");

    await writeOAuthSections(
      file,
      { servers: { [url]: NEW_STATE }, idpSessions: {} },
      { servers: [url] },
      store,
    );

    expect(await store.get(serverId, "tokens")).toBe(OLD_TOKENS);
    expect(await store.get(serverId, "client-secret")).toBe("old-cs");
    const written = JSON.parse(await readFile(file, "utf8")) as {
      servers: Record<string, { clientInformation?: { client_id?: string } }>;
    };
    expect(written.servers[url]?.clientInformation?.client_id).toBe("cid");
    expect(JSON.stringify(written)).not.toContain("new-cs");
    expect(JSON.stringify(written)).not.toContain("new-at");
  });

  it("aborts the file write when the compensation cannot be confirmed", async () => {
    // The failing field's prior value existed, so its restore goes through
    // `set` — which is still down. An unconfirmed restore leaves the store
    // in an unknown state; committing the residue over it would be a guess,
    // so the write must abort and surface the store failure.
    const { store, serverId } = await storeWithFailingSet(
      (field) => field === "client-secret",
    );
    const dir = await mkdtemp(join(tmpdir(), "oauth-persist-abort-"));
    const file = join(dir, "oauth.json");

    await expect(
      writeOAuthSections(
        file,
        { servers: { [url]: NEW_STATE }, idpSessions: {} },
        { servers: [url] },
        store,
      ),
    ).rejects.toBeInstanceOf(KeychainUnavailableError);

    expect(existsSync(file)).toBe(false);
    // The sibling that landed was still rolled back before the abort.
    expect(await store.get(serverId, "tokens")).toBe(OLD_TOKENS);
    expect(await store.get(serverId, "client-secret")).toBe("old-cs");
  });
});
