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
    clientInformation: { client_id: "new-cid", client_secret: "new-cs" },
  };
  const SEED_STATE = {
    tokens: { access_token: "old-at", token_type: "Bearer" },
    clientInformation: { client_id: "old-cid", client_secret: "old-cs" },
  };
  const OLD_TOKENS = JSON.stringify(SEED_STATE.tokens);

  /** Seed a real prior entry — residue on disk, secrets in the store — then
   * make `set` reject per `failWhen`. The bulk-set fallback settles siblings
   * before rethrowing, so a selective failure produces a real partial
   * commit. */
  const seededStore = async (
    file: string,
    failWhen: (field: string, value: string) => boolean,
  ) => {
    const store = new InMemorySecretStore();
    const serverId = oauthSecretServerId(url);
    await writeOAuthSections(
      file,
      { servers: { [url]: SEED_STATE }, idpSessions: {} },
      { servers: [url] },
      store,
    );
    const realSet = store.set.bind(store);
    store.set = async (sid: string, field: string, value: string) => {
      if (failWhen(field, value))
        throw new KeychainUnavailableError(new Error("keychain flaked"));
      return realSet(sid, field, value);
    };
    return { store, serverId };
  };

  it("degrades to the consistent prior pair after a partial bulk-set commit", async () => {
    // One sibling set lands ("tokens") while another fails ("client-secret").
    // The store side is restored to the pre-write values — and the file must
    // keep the *prior* residue too: committing the new residue over restored
    // old secrets would pair the re-registered client_id with the old
    // client_secret, a credential pair that never existed. File and store
    // change together or not at all; the new credentials stay memory-only.
    const dir = await mkdtemp(join(tmpdir(), "oauth-persist-partial-"));
    const file = join(dir, "oauth.json");
    const { store, serverId } = await seededStore(
      file,
      (field, value) => field === "client-secret" && value === "new-cs",
    );

    await writeOAuthSections(
      file,
      { servers: { [url]: NEW_STATE }, idpSessions: {} },
      { servers: [url] },
      store,
    );

    expect(await store.get(serverId, "tokens")).toBe(OLD_TOKENS);
    expect(await store.get(serverId, "client-secret")).toBe("old-cs");
    const written = await readFile(file, "utf8");
    const parsed = JSON.parse(written) as {
      servers: Record<string, { clientInformation?: { client_id?: string } }>;
    };
    expect(parsed.servers[url]?.clientInformation?.client_id).toBe("old-cid");
    for (const leak of ["new-cid", "new-cs", "new-at", "new-rt"]) {
      expect(written).not.toContain(leak);
    }
  });

  it("aborts the file write when the compensation cannot be confirmed", async () => {
    // The failing field's prior value existed, so its restore goes through
    // `set` — which is still down. An unconfirmed restore leaves the store
    // in an unknown state; committing anything over it would be a guess,
    // so the write must abort and surface the store failure.
    const dir = await mkdtemp(join(tmpdir(), "oauth-persist-abort-"));
    const file = join(dir, "oauth.json");
    const { store, serverId } = await seededStore(
      file,
      (field) => field === "client-secret",
    );
    const before = await readFile(file, "utf8");

    await expect(
      writeOAuthSections(
        file,
        { servers: { [url]: NEW_STATE }, idpSessions: {} },
        { servers: [url] },
        store,
      ),
    ).rejects.toBeInstanceOf(KeychainUnavailableError);

    expect(await readFile(file, "utf8")).toBe(before);
    // The sibling that landed was still rolled back before the abort.
    expect(await store.get(serverId, "tokens")).toBe(OLD_TOKENS);
    expect(await store.get(serverId, "client-secret")).toBe("old-cs");
  });

  it("drops a brand-new entry from the write when its secrets could not persist", async () => {
    // The disk never had this entry, so after the degradation there is no
    // prior pair to keep — committing any residue would index secrets the
    // store does not hold. The entry is removed from the write entirely
    // (restore of never-present fields is a delete, which succeeds, so the
    // write itself still goes through).
    const dir = await mkdtemp(join(tmpdir(), "oauth-persist-new-entry-"));
    const file = join(dir, "oauth.json");
    const store = new InMemorySecretStore();
    store.set = async () => {
      throw new KeychainUnavailableError(new Error("keychain down"));
    };

    await writeOAuthSections(
      file,
      { servers: { [url]: NEW_STATE }, idpSessions: {} },
      { servers: [url] },
      store,
    );

    const parsed = JSON.parse(await readFile(file, "utf8")) as {
      servers: Record<string, unknown>;
    };
    expect(parsed.servers).toEqual({});
  });
});
