/**
 * `FileSecretStore` against a real filesystem (#1950).
 *
 * A real temp directory rather than a mocked `fs`: the properties worth
 * asserting here are properties *of the file* — its mode, that a second
 * store reading it back sees the same secrets, that the ciphertext does
 * not contain the plaintext — and a mocked filesystem can be made to
 * agree with any of those without them being true.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import { existsSync as existsSyncFile } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  FileSecretStore,
  readSecretFilePermissions,
  resolveSecretPassphrase,
  SECRET_KEY_ENV,
  SECRET_KEY_FILE_ENV,
  SecretFileKeyMismatchError,
  tightenSecretFilePermissions,
} from "@inspector/core/auth/node/file-secret-store.js";
import { SecretStoreUnavailableError } from "@inspector/core/auth/node/secret-store.js";
import { SECRET_FIELD_OAUTH_CLIENT_SECRET } from "@inspector/core/auth/secret-fields.js";
import { describeSecretStoreContract } from "./secretStoreContract.js";

let tmpDir: string;
const filePath = (): string => path.join(tmpDir, "secrets.json");

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "inspector-secrets-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Both modes must satisfy the same contract — encryption is a property of
// the bytes on disk, not of the interface, and a caller must not be able to
// tell which one it got.
describeSecretStoreContract(
  "FileSecretStore (plaintext)",
  () => new FileSecretStore({ filePath: filePath() }),
);
describeSecretStoreContract(
  "FileSecretStore (encrypted)",
  () => new FileSecretStore({ filePath: filePath(), passphrase: "hunter2" }),
);

describe("FileSecretStore persistence", () => {
  it("a second store instance reads what the first wrote", async () => {
    const a = new FileSecretStore({ filePath: filePath() });
    await a.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "shh");
    const b = new FileSecretStore({ filePath: filePath() });
    expect(await b.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe("shh");
  });

  it("round-trips through a real encrypt/decrypt cycle across instances", async () => {
    const a = new FileSecretStore({
      filePath: filePath(),
      passphrase: "hunter2",
    });
    await a.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "shh");
    const b = new FileSecretStore({
      filePath: filePath(),
      passphrase: "hunter2",
    });
    expect(await b.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe("shh");
  });

  it("writes the file 0600", async () => {
    const store = new FileSecretStore({ filePath: filePath() });
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "shh");
    const stat = await fs.stat(filePath());
    // Windows does not model POSIX modes; asserting there would fail for a
    // reason that has nothing to do with this code.
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it("concurrent sets do not lose each other (the read-modify-write race)", async () => {
    // The route handlers write a server's fields with `Promise.all`, so this
    // is the ordinary path. Without the internal queue both calls read the
    // same empty map and the second write drops the first entry.
    const store = new FileSecretStore({ filePath: filePath() });
    await Promise.all([
      store.set("alpha", "env:A", "1"),
      store.set("alpha", "env:B", "2"),
      store.set("alpha", "env:C", "3"),
    ]);
    expect(await store.get("alpha", "env:A")).toBe("1");
    expect(await store.get("alpha", "env:B")).toBe("2");
    expect(await store.get("alpha", "env:C")).toBe("3");
  });

  it("keeps the file after the last entry is deleted", async () => {
    // The file's presence records which encryption mode this install settled
    // on; unlinking it would let a later write silently switch modes.
    const store = new FileSecretStore({ filePath: filePath() });
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "shh");
    await store.deleteAllForServer("alpha");
    await expect(fs.stat(filePath())).resolves.toBeDefined();
  });
});

describe("FileSecretStore at rest", () => {
  it("plaintext mode stores the value readably (the state the warning is about)", async () => {
    const store = new FileSecretStore({ filePath: filePath() });
    expect(store.encrypted).toBe(false);
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "super-secret");
    const raw = await fs.readFile(filePath(), "utf-8");
    expect(raw).toContain("super-secret");
    expect(JSON.parse(raw).encryption).toBe("none");
  });

  it("encrypted mode leaves neither the value nor the account name on disk", async () => {
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "hunter2",
    });
    expect(store.encrypted).toBe(true);
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "super-secret");
    const raw = await fs.readFile(filePath(), "utf-8");
    expect(raw).not.toContain("super-secret");
    // The account names are encrypted too — that's why the map is encrypted
    // as a unit rather than value-by-value, since the key list would
    // otherwise index which servers hold which kind of secret.
    expect(raw).not.toContain("alpha");
    expect(raw).not.toContain(SECRET_FIELD_OAUTH_CLIENT_SECRET);
    const parsed = JSON.parse(raw);
    expect(parsed.encryption).toBe("aes-256-gcm");
    expect(parsed.kdf.algorithm).toBe("scrypt");
  });

  it("treats a blank passphrase as no passphrase", async () => {
    // `MCP_INSPECTOR_SECRET_KEY=` in a compose file means "off", not a
    // zero-length key — and silently encrypting with "" would be worse than
    // either reading.
    expect(
      new FileSecretStore({ filePath: filePath(), passphrase: "   " })
        .encrypted,
    ).toBe(false);
  });

  it("upgrades an existing plaintext file to encrypted on the next write", async () => {
    const plain = new FileSecretStore({ filePath: filePath() });
    await plain.set("alpha", "env:A", "1");
    const encrypted = new FileSecretStore({
      filePath: filePath(),
      passphrase: "hunter2",
    });
    // Reads the plaintext file it inherited...
    expect(await encrypted.get("alpha", "env:A")).toBe("1");
    // ...and the next write carries the old entry into the encrypted form,
    // so setting the env var does not strand the secrets already stored.
    await encrypted.set("alpha", "env:B", "2");
    const raw = await fs.readFile(filePath(), "utf-8");
    expect(JSON.parse(raw).encryption).toBe("aes-256-gcm");
    expect(await encrypted.get("alpha", "env:A")).toBe("1");
  });
});

describe("FileSecretStore failure handling", () => {
  const writeEncryptedFixture = async (): Promise<void> => {
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "right-key",
    });
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "shh");
  };

  it("get returns null when the passphrase is wrong (read tolerance)", async () => {
    await writeEncryptedFixture();
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "wrong-key",
    });
    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      null,
    );
  });

  it("set refuses rather than overwriting a file it cannot decrypt", async () => {
    await writeEncryptedFixture();
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "wrong-key",
    });
    await expect(store.set("alpha", "env:A", "1")).rejects.toBeInstanceOf(
      SecretFileKeyMismatchError,
    );
    // The original secrets survive: the refusal is the whole point.
    const original = new FileSecretStore({
      filePath: filePath(),
      passphrase: "right-key",
    });
    expect(await original.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      "shh",
    );
  });

  it("set names the missing passphrase when the key was removed entirely", async () => {
    await writeEncryptedFixture();
    const store = new FileSecretStore({ filePath: filePath() });
    await expect(store.set("alpha", "env:A", "1")).rejects.toThrow(
      /MCP_INSPECTOR_SECRET_KEY is not set/,
    );
  });

  it("refuses a non-string value before touching the file", async () => {
    // A cast slipping past the compile-time contract (say a numeric
    // client_secret from a malformed payload) must not be written: one
    // non-string value makes `asSecretMap` refuse the whole file on every
    // later read and write, poisoning unrelated stored credentials.
    const store = new FileSecretStore({ filePath: filePath() });
    await store.set("alpha", "keep", "safe");
    await expect(
      store.set("alpha", "bad", 123 as unknown as string),
    ).rejects.toThrow(/non-string secret value \(number\) for "bad"/);
    await expect(
      store.setMany("alpha", {
        ok: "fine",
        worse: { nested: true } as unknown as string,
      }),
    ).rejects.toThrow(/non-string secret value \(object\) for "worse"/);
    // Nothing from the refused batch landed, and the store still works.
    expect(await store.get("alpha", "bad")).toBeNull();
    expect(await store.get("alpha", "ok")).toBeNull();
    expect(await store.get("alpha", "keep")).toBe("safe");
    await store.set("alpha", "after", "still-writable");
    expect(await store.get("alpha", "after")).toBe("still-writable");
  });

  it("reads a plaintext file that carries no secrets key as empty", async () => {
    // A hand-edited (or hand-created) file is the realistic source of this
    // shape, and it must read as "no secrets yet" rather than throwing: the
    // document is well-formed and declares its encryption mode, so the only
    // thing missing is entries. Flattening it to `{}` is also what lets the
    // next `set` add one instead of refusing.
    await fs.writeFile(
      filePath(),
      JSON.stringify({ version: 1, encryption: "none" }),
      "utf-8",
    );
    const store = new FileSecretStore({ filePath: filePath() });
    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      null,
    );
    await store.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "shh");
    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      "shh",
    );
  });

  it("refuses a file written by a newer format version", async () => {
    // Readable as far as the plaintext branch is concerned, which is the trap:
    // accepting it means the next write rewrites it as version 1 and silently
    // drops whatever the newer format added. Same refusal the encrypted branch
    // already gives, so the answer doesn't depend on which mode the newer
    // writer happened to choose.
    await fs.writeFile(
      filePath(),
      JSON.stringify({
        version: 2,
        encryption: "none",
        secrets: { "a:b": "1" },
      }),
      "utf-8",
    );
    const store = new FileSecretStore({ filePath: filePath() });
    expect(await store.get("a", "b")).toBe(null);
    await expect(store.set("a", "b", "2")).rejects.toThrow(/version 2/);
    // The bytes are still there — nothing was destroyed to answer the write.
    const raw = JSON.parse(await fs.readFile(filePath(), "utf-8")) as {
      version: number;
    };
    expect(raw.version).toBe(2);
  });

  it("delete rejects on a file it cannot decrypt", async () => {
    // A deletion that cannot be confirmed must escape: committing state
    // that assumes the entry is gone would resurrect it once the file
    // decrypts again.
    await writeEncryptedFixture();
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "wrong-key",
    });
    await expect(
      store.delete("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET),
    ).rejects.toBeInstanceOf(SecretStoreUnavailableError);
    await expect(store.deleteAllForServer("alpha")).rejects.toBeInstanceOf(
      SecretStoreUnavailableError,
    );
  });

  it("set reports a corrupt file rather than silently replacing it", async () => {
    await fs.writeFile(filePath(), "{ not json", "utf-8");
    const store = new FileSecretStore({ filePath: filePath() });
    await expect(store.set("alpha", "env:A", "1")).rejects.toBeInstanceOf(
      SecretStoreUnavailableError,
    );
    expect(await store.get("alpha", "env:A")).toBe(null);
  });

  it("set reports a file written by a newer format version", async () => {
    // The forward-compat case: a newer Inspector's file, opened by an older
    // one. Refusing beats truncating it to the entries we happen to parse.
    // The version is checked before the encryption mode, so this is the
    // message even though the cipher is also unrecognized — the version is
    // the more actionable of the two ("upgrade"), and it is the reason the
    // file is unreadable regardless of what the cipher turned out to be.
    await fs.writeFile(
      filePath(),
      JSON.stringify({ version: 99, encryption: "chacha20-poly1305" }),
      "utf-8",
    );
    const store = new FileSecretStore({ filePath: filePath() });
    await expect(store.set("alpha", "env:A", "1")).rejects.toThrow(
      /format version 99/,
    );
  });

  it("set reports an unrecognized cipher at a version it does understand", async () => {
    // The other half: a file this build's version check accepts, whose
    // encryption mode it has no code for. A different failure with different
    // advice, so it must not collapse into the version message.
    await fs.writeFile(
      filePath(),
      JSON.stringify({ version: 1, encryption: "chacha20-poly1305" }),
      "utf-8",
    );
    const store = new FileSecretStore({ filePath: filePath() });
    await expect(store.set("alpha", "env:A", "1")).rejects.toThrow(
      /unsupported format/,
    );
  });

  it("blames the file, not the passphrase, for a malformed envelope", async () => {
    // A truncated payload or an out-of-range KDF parameter used to surface as
    // `SecretFileKeyMismatchError`, whose 503 tells the user to restore a
    // passphrase — advice that cannot repair a structurally broken file.
    await writeEncryptedFixture();
    const parsed = JSON.parse(await fs.readFile(filePath(), "utf-8"));
    parsed.kdf.N = 3;
    await fs.writeFile(filePath(), JSON.stringify(parsed), "utf-8");
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "right-key",
    });
    await expect(store.set("alpha", "env:A", "1")).rejects.toThrow(
      /Restoring a passphrase will not repair it/,
    );
  });

  it("set reports a truncated ciphertext payload as a structural fault", async () => {
    await writeEncryptedFixture();
    const parsed = JSON.parse(await fs.readFile(filePath(), "utf-8"));
    parsed.data = "only-one-part";
    await fs.writeFile(filePath(), JSON.stringify(parsed), "utf-8");
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "right-key",
    });
    await expect(store.set("alpha", "env:A", "1")).rejects.toThrow(
      /encrypted payload is not iv\.tag\.ciphertext/,
    );
  });

  it("refuses an authentic tag truncated to 4 bytes (#2485)", async () => {
    // A genuine tag, cut short. Node 22 (the engines floor) authenticates a
    // 4-byte GCM tag unless the length is pinned, which makes a forgery a
    // ~2^-32 guess — so no read may return the secret, whatever the runtime.
    await writeEncryptedFixture();
    const parsed = JSON.parse(await fs.readFile(filePath(), "utf-8"));
    const [iv, tag, body] = parsed.data.split(".");
    const short = Buffer.from(tag, "base64").subarray(0, 4).toString("base64");
    parsed.data = `${iv}.${short}.${body}`;
    await fs.writeFile(filePath(), JSON.stringify(parsed), "utf-8");
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "right-key",
    });
    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      null,
    );
    await expect(
      store.getStrict("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET),
    ).rejects.toThrow(/authentication tag is 4 bytes, expected 16/);
    expect(await store.readOnDiskEncryption()).toEqual({
      state: "unreadable",
      detail: "authentication tag is 4 bytes, expected 16",
    });
  });

  it("pins the tag length at the cipher, not only in the envelope check (#2485)", async () => {
    // The test above cannot see this: `encryptedEnvelopeProblem` rejects a
    // short tag before `createDecipheriv` runs, and current Node rejects one
    // natively. So observe the options themselves — without them, Node 22
    // authenticates a 4-byte tag should the envelope check ever regress.
    const seen: { cipher: unknown[]; decipher: unknown[] } = {
      cipher: [],
      decipher: [],
    };
    vi.resetModules();
    vi.doMock("node:crypto", async () => {
      const actual =
        await vi.importActual<typeof import("node:crypto")>("node:crypto");
      return {
        ...actual,
        default: actual,
        createCipheriv: (...args: Parameters<typeof actual.createCipheriv>) => {
          seen.cipher.push(args[3]);
          return actual.createCipheriv(...args);
        },
        createDecipheriv: (
          ...args: Parameters<typeof actual.createDecipheriv>
        ) => {
          seen.decipher.push(args[3]);
          return actual.createDecipheriv(...args);
        },
      };
    });
    try {
      const mod =
        await import("@inspector/core/auth/node/file-secret-store.js");
      const fresh = new mod.FileSecretStore({
        filePath: filePath(),
        passphrase: "right-key",
      });
      await fresh.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "shh");
      expect(await fresh.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
        "shh",
      );
      expect(seen.cipher).toEqual([{ authTagLength: 16 }]);
      expect(seen.decipher.length).toBeGreaterThan(0);
      for (const options of seen.decipher) {
        expect(options).toEqual({ authTagLength: 16 });
      }
    } finally {
      vi.doUnmock("node:crypto");
      vi.resetModules();
    }
  });

  it("blames the file, not the passphrase, for a decrypted-but-corrupt payload", async () => {
    // GCM has already authenticated by this point, so the passphrase is
    // *proven correct* — telling the user to restore it sends them after a
    // secret they never lost. `asSecretMap` was already outside the catch for
    // this reason; `JSON.parse` was not.
    await writeEncryptedFixtureWithPlaintext("{ not json at all", "right-key");
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "right-key",
    });
    await expect(store.set("alpha", "env:A", "1")).rejects.toThrow(
      /The passphrase is correct; the file itself is corrupt/,
    );
  });

  it("still blames the passphrase when the envelope is well-formed", async () => {
    // The other half: structure fine, authentication fails. That *is* a key
    // problem and must keep the advice that fits it — the round-16 change
    // must not have turned every failure into a structural one.
    await writeEncryptedFixture();
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "wrong-key",
    });
    await expect(store.set("alpha", "env:A", "1")).rejects.toBeInstanceOf(
      SecretFileKeyMismatchError,
    );
  });

  it("reports a file whose KDF parameters are unusable", async () => {
    // scrypt rejects out-of-grammar cost parameters (`N` must be a power of
    // two > 1). Those parameters come off disk, so this is a corrupt-file
    // case — and since round 16 it is diagnosed *as* one: it used to surface
    // as a key mismatch, whose advice ("restore the passphrase") cannot
    // repair a malformed file.
    await writeEncryptedFixture();
    const parsed = JSON.parse(await fs.readFile(filePath(), "utf-8"));
    parsed.kdf.N = 3;
    await fs.writeFile(filePath(), JSON.stringify(parsed), "utf-8");
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "right-key",
    });
    expect(await store.get("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET)).toBe(
      null,
    );
    await expect(store.set("alpha", "env:A", "1")).rejects.toThrow(
      /kdf N is 3, which is not a power of two above 1/,
    );
  });

  it("reports a read failure that isn't a missing file", async () => {
    // A directory where the file should be: `readStoreFile` only translates
    // ENOENT into "no file yet", so anything else must surface as a refusal
    // rather than being read as an empty store and overwritten.
    const asDir = path.join(tmpDir, "as-dir");
    await fs.mkdir(asDir);
    const store = new FileSecretStore({ filePath: asDir });
    await expect(store.set("alpha", "env:A", "1")).rejects.toBeInstanceOf(
      SecretStoreUnavailableError,
    );
  });

  it("a rejected set leaves the same store usable for later operations", async () => {
    // The internal queue swallows failures on its chain so one rejection can't
    // strand every subsequent call on that store — the returned promise still
    // rejects, which is what the caller sees.
    await writeEncryptedFixture();
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "wrong-key",
    });
    await expect(store.set("alpha", "env:A", "1")).rejects.toThrow();
    expect(await store.get("alpha", "env:A")).toBe(null);
    await expect(store.delete("alpha", "env:A")).rejects.toThrow();
    await expect(store.set("alpha", "env:B", "2")).rejects.toThrow();
  });

  it("delete is a no-op when the file exists but holds no matching entry", async () => {
    const store = new FileSecretStore({ filePath: filePath() });
    await store.set("alpha", "env:A", "1");
    await store.delete("beta", "env:A");
    await store.deleteAllForServer("gamma");
    expect(await store.get("alpha", "env:A")).toBe("1");
  });

  it("set reports an unreachable location instead of failing silently", async () => {
    // A path whose parent is a *file*: the read fails with ENOTDIR rather
    // than the ENOENT that means "no file yet", so this lands on the read
    // refusal. It is the class the 503 exists for — fixable outside the
    // process.
    const blocker = path.join(tmpDir, "blocker");
    await fs.writeFile(blocker, "x", "utf-8");
    const store = new FileSecretStore({
      filePath: path.join(blocker, "secrets.json"),
    });
    await expect(store.set("alpha", "env:A", "1")).rejects.toThrow(
      /Could not read the secrets file/,
    );
  });

  // A read that succeeds (or reports "no file yet") followed by a write that
  // fails — a read-only mount, a full disk, a permissions change since
  // startup. Reproduced with a non-writable directory, which requires not
  // being root: `chmod` is advisory to uid 0, so under root the write would
  // succeed and the assertion would be wrong rather than merely unexercised.
  // CI runs as an unprivileged user, which is where the coverage gate is
  // enforced.
  const asRoot = process.getuid?.() === 0;
  it.skipIf(asRoot || process.platform === "win32")(
    "set reports a write failure distinctly from a read failure",
    async () => {
      const dir = path.join(tmpDir, "locked");
      await fs.mkdir(dir);
      await fs.chmod(dir, 0o555);
      try {
        const store = new FileSecretStore({
          filePath: path.join(dir, "secrets.json"),
        });
        // Nothing is there to read, so the failure is unambiguously the write.
        await expect(store.set("alpha", "env:A", "1")).rejects.toThrow(
          /Could not write the secrets file/,
        );
      } finally {
        // Restore write permission or the afterEach `rm -rf` can't clean up.
        await fs.chmod(dir, 0o755);
      }
    },
  );

  it("a rejected set does not poison later sets on the same store", async () => {
    // The internal queue swallows on the chain but not on the returned
    // promise; without that, one failure would strand every subsequent write.
    const blocked = path.join(tmpDir, "blocker");
    await fs.writeFile(blocked, "x", "utf-8");
    const bad = new FileSecretStore({
      filePath: path.join(blocked, "secrets.json"),
    });
    await expect(bad.set("alpha", "env:A", "1")).rejects.toThrow();

    // A different store on a good path still works, and so does a second
    // write on the failing one's successor.
    const store = new FileSecretStore({ filePath: filePath() });
    await store.set("alpha", "env:A", "1");
    await store.set("alpha", "env:B", "2");
    expect(await store.get("alpha", "env:A")).toBe("1");
    expect(await store.get("alpha", "env:B")).toBe("2");
  });
});

describe("tightenSecretFilePermissions", () => {
  it("repairs a loosened mode on an existing file", async () => {
    if (process.platform === "win32") return;
    await fs.writeFile(filePath(), "{}", "utf-8");
    await fs.chmod(filePath(), 0o644);
    await tightenSecretFilePermissions(filePath());
    expect((await fs.stat(filePath())).mode & 0o777).toBe(0o600);
  });

  it("declines to interpret Windows' synthetic mode bits", async () => {
    // Windows does not model POSIX modes. `stat` still returns bits, and
    // reading them as a permission statement is a confident falsehood either
    // way — "0666 — not owner-only" about a file the ACL may restrict, or
    // "owner-only" about one it does not. The ACL is the real answer and this
    // does not inspect it.
    const store = new FileSecretStore({ filePath: filePath() });
    await store.set("alpha", "env:A", "1");
    const real = process.platform;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    try {
      expect(await readSecretFilePermissions(filePath())).toEqual({
        state: "unknown",
        detail: "not checked on Windows",
      });
    } finally {
      Object.defineProperty(process, "platform", {
        value: real,
        configurable: true,
      });
    }
  });

  it("still reports absent on Windows when there is no file", async () => {
    const real = process.platform;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    try {
      expect(
        await readSecretFilePermissions(path.join(tmpDir, "nope.json")),
      ).toEqual({ state: "absent" });
    } finally {
      Object.defineProperty(process, "platform", {
        value: real,
        configurable: true,
      });
    }
  });

  it("reports unknown, not absent, when an existing file cannot be inspected", async () => {
    // Collapsing every stat failure into "absent" is what made it dangerous:
    // the descriptor then omits the warning and the footer states mode 0600
    // as fact, having verified nothing.
    vi.resetModules();
    vi.doMock("node:fs/promises", async () => {
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      const denied = Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });
      return {
        ...actual,
        default: actual,
        stat: vi.fn(() => Promise.reject(denied)),
      };
    });
    try {
      const mod =
        await import("@inspector/core/auth/node/file-secret-store.js");
      expect(await mod.readSecretFilePermissions(filePath())).toEqual({
        state: "unknown",
        detail: "EACCES",
      });
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
    }
  });

  it("names an errno-less stat failure rather than printing undefined", async () => {
    vi.resetModules();
    vi.doMock("node:fs/promises", async () => {
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      // No `code` property — a rejection shaped unlike an errno error.
      return {
        ...actual,
        default: actual,
        stat: vi.fn(() => Promise.reject(new Error("something odd"))),
      };
    });
    try {
      const mod =
        await import("@inspector/core/auth/node/file-secret-store.js");
      expect(await mod.readSecretFilePermissions(filePath())).toEqual({
        state: "unknown",
        detail: "unknown error",
      });
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
    }
  });

  it("readSecretFilePermissions reports the mode without changing it", async () => {
    // The descriptor is rebuilt on every GET /api/config, so the function it
    // calls must not chmod — once per page load, on a file another process
    // may be mid-write on. The repair belongs at startup.
    const store = new FileSecretStore({ filePath: filePath() });
    await store.set("alpha", "env:A", "1");
    await fs.chmod(filePath(), 0o644);
    expect(await readSecretFilePermissions(filePath())).toEqual({
      state: "loose",
      mode: 0o644,
    });
    // Still 0644 — reading did not quietly repair it.
    expect((await fs.stat(filePath())).mode & 0o777).toBe(0o644);
  });

  it("reports absent, not a failure, for a file that doesn't exist yet", async () => {
    // The first-run case. Nothing to tighten and nothing to warn about —
    // `writeStoreFile` creates the file 0600.
    await expect(
      tightenSecretFilePermissions(path.join(tmpDir, "nope.json")),
    ).resolves.toEqual({ state: "absent" });
  });

  it("reports a mode it could not fix, instead of claiming 0600", async () => {
    // The case the caller has to hear about: the docs and the footer both say
    // the file is 0600, so a file we failed to tighten must be surfaced rather
    // than silently described as protected.
    //
    // Driven through a fresh module whose `chmod` rejects — a test cannot
    // readily own a file it lacks permission to chmod, and vitest cannot spy
    // on a `node:fs/promises` export because the ESM namespace is not
    // configurable.
    const store = new FileSecretStore({ filePath: filePath() });
    await store.set("alpha", "env:A", "1");
    await fs.chmod(filePath(), 0o644);

    vi.resetModules();
    vi.doMock("node:fs/promises", async () => {
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      return {
        ...actual,
        default: actual,
        chmod: vi.fn(() =>
          Promise.reject(new Error("EPERM: operation not permitted")),
        ),
      };
    });
    try {
      const mod =
        await import("@inspector/core/auth/node/file-secret-store.js");
      expect(await mod.tightenSecretFilePermissions(filePath())).toEqual({
        state: "loose",
        mode: 0o644,
      });
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
    }
  });
});

describe("readOnDiskEncryption", () => {
  it("reports what the file is, not what the store would write", async () => {
    // The whole reason it exists: these two disagree for a full session after
    // a passphrase is added to an install that already has a plaintext file.
    const plain = new FileSecretStore({ filePath: filePath() });
    await plain.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "shh");

    const withKey = new FileSecretStore({
      filePath: filePath(),
      passphrase: "hunter2",
    });
    expect(withKey.encrypted).toBe(true);
    expect(await withKey.readOnDiskEncryption()).toEqual({
      state: "plaintext",
    });

    await withKey.set("alpha", "env:A", "1");
    expect(await withKey.readOnDiskEncryption()).toEqual({
      state: "encrypted",
    });
  });

  it("keeps 'no file yet' apart from 'there is a file and we cannot read it'", async () => {
    // Collapsing these is what let a passphrase-configured install claim
    // "Encrypted file" about a corrupt file `set` was about to refuse: the
    // descriptor falls back to the write policy on `absent`, which is only
    // honest when the first write really will create the file that way.
    const store = new FileSecretStore({ filePath: filePath() });
    expect(await store.readOnDiskEncryption()).toEqual({ state: "absent" });

    await fs.writeFile(filePath(), "{not json", "utf-8");
    expect(await store.readOnDiskEncryption()).toEqual({
      state: "unreadable",
      detail: "not valid JSON",
    });

    await fs.writeFile(
      filePath(),
      JSON.stringify({ version: 1, encryption: "rot13" }),
      "utf-8",
    );
    const unsupported = await store.readOnDiskEncryption();
    expect(unsupported.state).toBe("unreadable");
    expect(
      unsupported.state === "unreadable" ? unsupported.detail : "",
    ).toMatch(/unsupported envelope/);
  });

  it("calls a newer format version unreadable rather than usable", async () => {
    // `readMap` refuses such a file, so describing it as a working plaintext
    // or encrypted store would present it as fine while every save fails.
    await fs.writeFile(
      filePath(),
      JSON.stringify({ version: 2, encryption: "none", secrets: {} }),
      "utf-8",
    );
    const store = new FileSecretStore({ filePath: filePath() });
    const state = await store.readOnDiskEncryption();
    expect(state.state).toBe("unreadable");
    expect(state.state === "unreadable" ? state.detail : "").toMatch(
      /format version 2/,
    );
  });

  it("reports a file the current passphrase cannot open as unreadable, not encrypted", async () => {
    // This asserted the opposite until round 12, and the reviewer was right
    // to call it: structure is not access. A store with the wrong key — or
    // none — reads `null` from every `get` and refuses every `set`, so
    // describing the file as "encrypted" gives the quiet, healthy footer to
    // precisely the state the unreadable one exists to warn about. The user
    // then discovers it when their save fails.
    const writer = new FileSecretStore({
      filePath: filePath(),
      passphrase: "right-key",
    });
    await writer.set("alpha", SECRET_FIELD_OAUTH_CLIENT_SECRET, "shh");

    for (const wrong of [
      new FileSecretStore({ filePath: filePath() }),
      new FileSecretStore({ filePath: filePath(), passphrase: "wrong-key" }),
    ]) {
      const state = await wrong.readOnDiskEncryption();
      expect(state.state).toBe("unreadable");
      expect(state.state === "unreadable" ? state.detail : "").toMatch(
        /cannot be decrypted with the current MCP_INSPECTOR_SECRET_KEY/,
      );
    }

    // And the store that *can* open it is still described as encrypted.
    expect(await writer.readOnDiskEncryption()).toEqual({ state: "encrypted" });
  });
});

/**
 * Write a genuinely-encrypted secrets file whose decrypted payload is
 * `payload` — including payloads the store would never produce.
 *
 * Hand-rolled against the documented format rather than driven through the
 * store, because the whole point is to reach a state the store's own writer
 * cannot create: an authentic ciphertext (right passphrase, valid GCM tag)
 * carrying the wrong shape. Anything less would test the key check instead
 * of the shape check.
 */
async function writeEncryptedFixtureWithPayload(
  payload: unknown,
  passphrase: string,
): Promise<void> {
  return writeEncryptedFixtureWithPlaintext(
    JSON.stringify(payload),
    passphrase,
  );
}

/**
 * The same, but writing `plaintext` verbatim — so a fixture can carry bytes
 * that are authentic under the passphrase and still not valid JSON, which
 * `JSON.stringify` can never produce.
 */
async function writeEncryptedFixtureWithPlaintext(
  plaintext: string,
  passphrase: string,
): Promise<void> {
  const salt = crypto.randomBytes(16);
  const kdf = {
    algorithm: "scrypt",
    salt: salt.toString("base64"),
    N: 16384,
    r: 8,
    p: 1,
  };
  const key: Buffer = await new Promise((resolve, reject) => {
    crypto.scrypt(
      passphrase,
      salt,
      32,
      { N: kdf.N, r: kdf.r, p: kdf.p },
      (err, k) => (err ? reject(err) : resolve(k)),
    );
  });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const data = [iv, cipher.getAuthTag(), body]
    .map((b) => b.toString("base64"))
    .join(".");
  await fs.writeFile(
    filePath(),
    JSON.stringify({ version: 1, encryption: "aes-256-gcm", kdf, data }),
    "utf-8",
  );
}

describe("getMany", () => {
  it("returns a server's fields from a single read", async () => {
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "hunter2",
    });
    await store.set("srv", SECRET_FIELD_OAUTH_CLIENT_SECRET, "s1");
    await store.set("srv", "env:TOKEN", "s2");
    await store.set("other", "env:TOKEN", "nope");

    expect(
      await store.getMany([
        {
          serverId: "srv",
          fields: [SECRET_FIELD_OAUTH_CLIENT_SECRET, "env:TOKEN", "env:ABSENT"],
        },
      ]),
    ).toEqual({
      srv: { [SECRET_FIELD_OAUTH_CLIENT_SECRET]: "s1", "env:TOKEN": "s2" },
    });
  });

  it("derives the key once for the whole set, not once per field", async () => {
    // The reason the seam exists: `get` reads and decrypts the *entire* file,
    // so rehydrating field-by-field cost one scrypt derivation per field,
    // serialized behind this store's queue. Counting derivations is the
    // measurement that matters — scrypt is the expensive part, deliberately
    // so.
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "hunter2",
    });
    await store.set("srv", "env:A", "1");
    await store.set("srv", "env:B", "2");
    await store.set("srv", "env:C", "3");

    let derivations = 0;
    vi.resetModules();
    vi.doMock("node:crypto", async () => {
      const actual =
        await vi.importActual<typeof import("node:crypto")>("node:crypto");
      return {
        ...actual,
        default: actual,
        scrypt: (...args: Parameters<typeof actual.scrypt>) => {
          derivations += 1;
          return actual.scrypt(...args);
        },
      };
    });
    try {
      const mod =
        await import("@inspector/core/auth/node/file-secret-store.js");
      const fresh = new mod.FileSecretStore({
        filePath: filePath(),
        passphrase: "hunter2",
      });

      await fresh.getMany([
        { serverId: "srv", fields: ["env:A", "env:B", "env:C"] },
      ]);
      expect(derivations).toBe(1);

      // And the shape it replaced, for contrast: three fields, three
      // derivations.
      derivations = 0;
      await fresh.get("srv", "env:A");
      await fresh.get("srv", "env:B");
      await fresh.get("srv", "env:C");
      expect(derivations).toBe(3);
    } finally {
      vi.doUnmock("node:crypto");
      vi.resetModules();
    }
  });

  it("derives the key once for MANY SERVERS, not once per server", async () => {
    // The finding this pins (round 13): a per-server seam did not fix the
    // case it was written for. Both rehydration callers iterate servers, so
    // 20 servers holding one secret each still paid 20 serialized
    // derivations — the same stall, reached one server at a time.
    vi.resetModules();
    let derivations = 0;
    vi.doMock("node:crypto", async () => {
      const actual =
        await vi.importActual<typeof import("node:crypto")>("node:crypto");
      return {
        ...actual,
        default: actual,
        scrypt: (...args: Parameters<typeof actual.scrypt>) => {
          derivations++;
          return actual.scrypt(...args);
        },
      };
    });
    try {
      const mod =
        await import("@inspector/core/auth/node/file-secret-store.js");
      const seed = new mod.FileSecretStore({
        filePath: filePath(),
        passphrase: "hunter2",
      });
      for (const id of ["a", "b", "c", "d"]) {
        await seed.set(id, "env:TOKEN", `v-${id}`);
      }

      derivations = 0;
      const result = await seed.getMany(
        ["a", "b", "c", "d"].map((serverId) => ({
          serverId,
          fields: ["env:TOKEN"],
        })),
      );
      expect(derivations).toBe(1);
      expect(result).toEqual({
        a: { "env:TOKEN": "v-a" },
        b: { "env:TOKEN": "v-b" },
        c: { "env:TOKEN": "v-c" },
        d: { "env:TOKEN": "v-d" },
      });
    } finally {
      vi.doUnmock("node:crypto");
      vi.resetModules();
    }
  });

  it("setMany derives the key once, not three times per field", async () => {
    // `set` is a read-decrypt-encrypt-write-verify cycle per call — roughly
    // three derivations each — and the settings form resends a server's full
    // env map on any edit, so a 10-variable server paid ~30 to save an
    // unrelated timeout change.
    vi.resetModules();
    let derivations = 0;
    vi.doMock("node:crypto", async () => {
      const actual =
        await vi.importActual<typeof import("node:crypto")>("node:crypto");
      return {
        ...actual,
        default: actual,
        scrypt: (...args: Parameters<typeof actual.scrypt>) => {
          derivations++;
          return actual.scrypt(...args);
        },
      };
    });
    try {
      const mod =
        await import("@inspector/core/auth/node/file-secret-store.js");
      const store = new mod.FileSecretStore({
        filePath: filePath(),
        passphrase: "hunter2",
      });
      await store.set("srv", "env:SEED", "0");

      derivations = 0;
      await store.setMany("srv", {
        "env:A": "1",
        "env:B": "2",
        "env:C": "3",
      });
      const bulk = derivations;

      derivations = 0;
      await store.set("srv", "env:D", "4");
      const single = derivations;

      // Three fields in one cycle must not cost more than one field does.
      expect(bulk).toBeLessThanOrEqual(single);
      expect(await store.get("srv", "env:A")).toBe("1");
      expect(await store.get("srv", "env:C")).toBe("3");
      expect(await store.get("srv", "env:SEED")).toBe("0");
    } finally {
      vi.doUnmock("node:crypto");
      vi.resetModules();
    }
  });

  it("setMany with nothing to write does not touch the file", async () => {
    const store = new FileSecretStore({ filePath: filePath() });
    await store.setMany("srv", {});
    expect(existsSyncFile(filePath())).toBe(false);
  });

  it("is tolerant like get: an unreadable store yields no fields", async () => {
    await fs.writeFile(filePath(), "{ not json", "utf-8");
    const store = new FileSecretStore({ filePath: filePath() });
    expect(
      await store.getMany([{ serverId: "srv", fields: ["env:A"] }]),
    ).toEqual({
      srv: {},
    });
  });
});

describe("payload shape validation", () => {
  // GCM proves who wrote the bytes, not what shape they parse to, and the
  // plaintext branch proves nothing at all — so neither may be cast.
  it("refuses a plaintext file whose secrets field is an array", async () => {
    // The array is the case a cast cannot survive: it passes `typeof
    // "object"`, takes the named assignment, and then `JSON.stringify` drops
    // every named property — so `set` would resolve having written a file
    // without the secret it was handed.
    await fs.writeFile(
      filePath(),
      JSON.stringify({ version: 1, encryption: "none", secrets: [] }),
      "utf-8",
    );
    const store = new FileSecretStore({ filePath: filePath() });
    await expect(store.set("alpha", "env:A", "1")).rejects.toThrow(/an array/);
    expect(await store.get("alpha", "env:A")).toBe(null);
  });

  it("refuses a plaintext file holding a non-string value", async () => {
    await fs.writeFile(
      filePath(),
      JSON.stringify({
        version: 1,
        encryption: "none",
        secrets: { "alpha:env:A": { nested: true } },
      }),
      "utf-8",
    );
    const store = new FileSecretStore({ filePath: filePath() });
    await expect(store.set("alpha", "env:B", "1")).rejects.toThrow(
      /non-string value for "alpha:env:A"/,
    );
  });

  it("refuses an authentic ciphertext that decodes to the wrong shape", async () => {
    // Encrypted with the right passphrase, so it decrypts cleanly and the
    // refusal can only come from the shape check. It must NOT surface as a key
    // mismatch, which would send the user to fix a passphrase that is working.
    await writeEncryptedFixtureWithPayload([], "hunter2");
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "hunter2",
    });
    expect(await store.get("alpha", "env:A")).toBe(null);
    const err = await store
      .set("alpha", "env:A", "1")
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SecretStoreUnavailableError);
    expect(err).not.toBeInstanceOf(SecretFileKeyMismatchError);
    expect((err as Error).message).toMatch(/an array/);
  });
});

describe("getStrict (round 9)", () => {
  it("returns the value like get does when the file is readable", async () => {
    const store = new FileSecretStore({ filePath: filePath() });
    await store.set("srv", "env:A", "1");
    expect(await store.getStrict("srv", "env:A")).toBe("1");
    expect(await store.getStrict("srv", "env:MISSING")).toBe(null);
  });

  it("throws where get would answer null, so a migration cannot write over a newer value", async () => {
    // The whole point of the seam: `get` maps an unreadable store to `null`,
    // and both plaintext migrations *write* on `null` and then delete the
    // disk copy. Falling back to `get` here left that inversion open on the
    // very store the seam was added for.
    const writer = new FileSecretStore({
      filePath: filePath(),
      passphrase: "right-key",
    });
    await writer.set("srv", "env:A", "1");

    const wrongKey = new FileSecretStore({
      filePath: filePath(),
      passphrase: "wrong-key",
    });
    expect(await wrongKey.get("srv", "env:A")).toBe(null);
    await expect(wrongKey.getStrict("srv", "env:A")).rejects.toBeInstanceOf(
      SecretFileKeyMismatchError,
    );
  });

  it("wraps a filesystem failure as SecretStoreUnavailableError", async () => {
    // Not a typed refusal — a raw ENOTDIR — which must still arrive as
    // something the migrations' catch recognises.
    const blocker = path.join(tmpDir, "blocker");
    await fs.writeFile(blocker, "x", "utf-8");
    const store = new FileSecretStore({
      filePath: path.join(blocker, "secrets.json"),
    });
    await expect(store.getStrict("srv", "env:A")).rejects.toBeInstanceOf(
      SecretStoreUnavailableError,
    );
  });
});

describe("getManyStrict", () => {
  it("returns values like getMany when the file is readable", async () => {
    const store = new FileSecretStore({ filePath: filePath() });
    await store.set("srv", "env:A", "1");
    expect(
      await store.getManyStrict([
        { serverId: "srv", fields: ["env:A", "env:MISSING"] },
      ]),
    ).toEqual({ srv: { "env:A": "1" } });
  });

  it("answers empty fields for a store file that does not exist yet", async () => {
    // Absence is a real answer — only *unreadability* must throw.
    const store = new FileSecretStore({ filePath: filePath() });
    expect(
      await store.getManyStrict([{ serverId: "srv", fields: ["env:A"] }]),
    ).toEqual({ srv: {} });
  });

  it("wraps a filesystem failure as SecretStoreUnavailableError", async () => {
    const blocker = path.join(tmpDir, "blocker");
    await fs.writeFile(blocker, "x", "utf-8");
    const store = new FileSecretStore({
      filePath: path.join(blocker, "secrets.json"),
    });
    await expect(
      store.getManyStrict([{ serverId: "srv", fields: ["env:A"] }]),
    ).rejects.toBeInstanceOf(SecretStoreUnavailableError);
  });

  it("throws where getMany yields no fields, so hydration cannot read an outage as absence", async () => {
    // OAuth read hydration feeds the memory state that sectioned writes
    // diff against; an unreadable store answering empty maps would make the
    // next save delete every credential the outage hid.
    await fs.writeFile(filePath(), "{ not json", "utf-8");
    const store = new FileSecretStore({ filePath: filePath() });
    expect(
      await store.getMany([{ serverId: "srv", fields: ["env:A"] }]),
    ).toEqual({ srv: {} });
    await expect(
      store.getManyStrict([{ serverId: "srv", fields: ["env:A"] }]),
    ).rejects.toBeInstanceOf(SecretStoreUnavailableError);
  });
});

describe("readOnDiskEncryption rejects an envelope it could not open", () => {
  // Naming the cipher is not the same as being openable, and reporting
  // "encrypted" for a file whose next save is guaranteed to fail is the
  // quiet, reassuring footer arriving for the worst case.
  it.each([
    [
      "no kdf or data",
      { version: 1, encryption: "aes-256-gcm" },
      "encrypted envelope is missing its kdf or data",
    ],
    [
      "data that is not iv.tag.ciphertext",
      {
        version: 1,
        encryption: "aes-256-gcm",
        kdf: { algorithm: "scrypt", salt: "AAAA", N: 16384, r: 8, p: 1 },
        data: "only-one-part",
      },
      "encrypted payload is not iv.tag.ciphertext",
    ],
    // Three dot-separated strings are not enough: each of these satisfies a
    // part-count check and still makes every decrypt throw, so reporting
    // "encrypted" would hand the quiet footer to a file whose next save is
    // guaranteed to fail.
    [
      "an initialization vector of the wrong length",
      {
        version: 1,
        encryption: "aes-256-gcm",
        kdf: { algorithm: "scrypt", salt: "AAAA", N: 16384, r: 8, p: 1 },
        data: `${Buffer.alloc(4).toString("base64")}.${Buffer.alloc(16).toString("base64")}.${Buffer.alloc(8).toString("base64")}`,
      },
      "initialization vector is 4 bytes, expected 12",
    ],
    [
      "an authentication tag of the wrong length",
      {
        version: 1,
        encryption: "aes-256-gcm",
        kdf: { algorithm: "scrypt", salt: "AAAA", N: 16384, r: 8, p: 1 },
        data: `${Buffer.alloc(12).toString("base64")}.${Buffer.alloc(3).toString("base64")}.${Buffer.alloc(8).toString("base64")}`,
      },
      "authentication tag is 3 bytes, expected 16",
    ],
    [
      "a KDF cost parameter node would reject",
      {
        version: 1,
        encryption: "aes-256-gcm",
        kdf: { algorithm: "scrypt", salt: "AAAA", N: 3, r: 8, p: 1 },
        data: `${Buffer.alloc(12).toString("base64")}.${Buffer.alloc(16).toString("base64")}.${Buffer.alloc(8).toString("base64")}`,
      },
      "kdf N is 3, which is not a power of two above 1",
    ],
    [
      "an empty ciphertext",
      {
        version: 1,
        encryption: "aes-256-gcm",
        kdf: { algorithm: "scrypt", salt: "AAAA", N: 16384, r: 8, p: 1 },
        data: `${Buffer.alloc(12).toString("base64")}.${Buffer.alloc(16).toString("base64")}.`,
      },
      "ciphertext is empty",
    ],
    [
      "a salt that is not base64",
      {
        version: 1,
        encryption: "aes-256-gcm",
        kdf: { algorithm: "scrypt", salt: "!!!", N: 16384, r: 8, p: 1 },
        data: `${Buffer.alloc(12).toString("base64")}.${Buffer.alloc(16).toString("base64")}.${Buffer.alloc(8).toString("base64")}`,
      },
      "kdf salt is missing or not base64",
    ],
    [
      "a non-positive KDF r",
      {
        version: 1,
        encryption: "aes-256-gcm",
        kdf: { algorithm: "scrypt", salt: "AAAA", N: 16384, r: 0, p: 1 },
        data: `${Buffer.alloc(12).toString("base64")}.${Buffer.alloc(16).toString("base64")}.${Buffer.alloc(8).toString("base64")}`,
      },
      "kdf r/p are 0/1, which are not positive integers",
    ],
    [
      "a KDF cost parameter large enough to burn unbounded CPU",
      {
        version: 1,
        encryption: "aes-256-gcm",
        kdf: {
          algorithm: "scrypt",
          salt: "AAAA",
          N: 16384,
          r: 8,
          p: 1_000_000,
        },
        data: `${Buffer.alloc(12).toString("base64")}.${Buffer.alloc(16).toString("base64")}.${Buffer.alloc(8).toString("base64")}`,
      },
      "kdf cost parameters (N=16384, r=8, p=1000000) exceed the supported maximum (N=16384, r=8, p=1)",
    ],
    [
      "an unsupported KDF",
      {
        version: 1,
        encryption: "aes-256-gcm",
        kdf: { algorithm: "pbkdf2", salt: "AAAA", N: 16384, r: 8, p: 1 },
        data: `${Buffer.alloc(12).toString("base64")}.${Buffer.alloc(16).toString("base64")}.${Buffer.alloc(8).toString("base64")}`,
      },
      'unsupported kdf "pbkdf2"',
    ],
  ])("reports unreadable for %s", async (_label, envelope, detail) => {
    await fs.writeFile(filePath(), JSON.stringify(envelope), "utf-8");
    const store = new FileSecretStore({ filePath: filePath() });
    expect(await store.readOnDiskEncryption()).toEqual({
      state: "unreadable",
      detail,
    });
  });
});

describe("readOnDiskEncryption validates the plaintext payload too", () => {
  it("reports unreadable for a plaintext file whose secrets are not a map", async () => {
    // The encrypted branch was tightened in round 12 and this one was left
    // behind, so `{ "encryption": "none", "secrets": [] }` — trivial to
    // hand-write — described a healthy plaintext store whose next save
    // `readMap` refuses.
    await fs.writeFile(
      filePath(),
      JSON.stringify({ version: 1, encryption: "none", secrets: [] }),
      "utf-8",
    );
    const store = new FileSecretStore({ filePath: filePath() });
    const state = await store.readOnDiskEncryption();
    expect(state.state).toBe("unreadable");
    expect(state.state === "unreadable" ? state.detail : "").toMatch(
      /does not hold a secret map/,
    );
  });

  it("still reports plaintext for a file this build actually wrote", async () => {
    const store = new FileSecretStore({ filePath: filePath() });
    await store.set("srv", "env:A", "1");
    expect(await store.readOnDiskEncryption()).toEqual({ state: "plaintext" });
  });
});

describe("readOnDiskEncryption accepts a real envelope", () => {
  it("still reports encrypted for a file this build actually wrote", async () => {
    // The negative cases above are only meaningful next to this: tightening
    // the validation must not start rejecting the files we produce.
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "hunter2",
    });
    await store.set("srv", "env:A", "1");
    expect(await store.readOnDiskEncryption()).toEqual({ state: "encrypted" });
  });
});

/**
 * Write an entirely different map straight to disk, bypassing the store.
 *
 * This is the *only* way to model a second process here. `serialize` keys
 * its queue on the resolved path, process-wide, so two `FileSecretStore`
 * instances pointing at one file do **not** race — they take turns. An
 * earlier version of these tests used two instances and believed it was
 * exercising the retry; it was exercising the queue, and passed for a
 * reason unrelated to the code under test.
 */
async function writeAsAnotherProcess(
  target: string,
  secrets: Record<string, string>,
): Promise<void> {
  await fs.writeFile(
    target,
    JSON.stringify({ version: 1, encryption: "none", secrets }),
    "utf-8",
  );
}

/** Inject one external write between the store's write and its verify. */
function injectOneExternalWrite(
  store: FileSecretStore,
  target: string,
  secrets: Record<string, string>,
): void {
  // Double cast: `writeMap` is private, so no single cast reaches it. Safe
  // because the asserted shape is its real signature — a rename or
  // signature change fails this line rather than silently detaching the
  // stub. See the note on `clobberAfterEveryWrite` below.
  const inner = store as unknown as {
    writeMap: (m: Record<string, string>) => Promise<void>;
  };
  const realWrite = inner.writeMap.bind(store);
  let done = false;
  inner.writeMap = async (map: Record<string, string>) => {
    await realWrite(map);
    if (done) return;
    done = true;
    await writeAsAnotherProcess(target, secrets);
  };
}

describe("descriptor and retry edge cases", () => {
  it("reports a decrypt that succeeds but yields the wrong shape", async () => {
    // Authentic ciphertext, right passphrase, wrong payload — so `readMap`
    // throws something that is *not* a key mismatch, and the descriptor must
    // surface that reason rather than the passphrase advice.
    await writeEncryptedFixtureWithPayload(["not", "a", "map"], "right-key");
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "right-key",
    });
    const state = await store.readOnDiskEncryption();
    expect(state.state).toBe("unreadable");
    expect(state.state === "unreadable" ? state.detail : "").toMatch(
      /does not hold a secret map/,
    );
  });

  it("retries when the verifying read itself fails, then reports the unreadable file", async () => {
    // The verify can fail rather than mismatch — another writer replacing the
    // file with something unparseable. That is not a clobber to re-apply
    // onto, so the attempt is abandoned and the next one reports the real
    // problem instead of looping silently.
    const store = new FileSecretStore({ filePath: filePath() });
    const inner = store as unknown as {
      writeMap: (m: Record<string, string>) => Promise<void>;
    };
    const realWrite = inner.writeMap.bind(store);
    inner.writeMap = async (map: Record<string, string>) => {
      await realWrite(map);
      await fs.writeFile(filePath(), "{ not json", "utf-8");
    };

    await expect(store.set("srv", "env:A", "1")).rejects.toBeInstanceOf(
      SecretStoreUnavailableError,
    );
  });

  it("getMany answers empty for a file that does not exist yet", async () => {
    const store = new FileSecretStore({ filePath: filePath() });
    expect(
      await store.getMany([{ serverId: "srv", fields: ["env:A", "env:B"] }]),
    ).toEqual({ srv: {} });
  });
});

describe("in-process mutations are serialized per path", () => {
  // Not a race, and the tests must not claim to be one. `serialize` is keyed
  // on the resolved path process-wide, so two instances on one file take
  // turns — which is a real property worth pinning, because it is what makes
  // the in-process case correct without relying on the optimistic retry.

  it("two stores writing one file keep both entries", async () => {
    const a = new FileSecretStore({ filePath: filePath() });
    const b = new FileSecretStore({ filePath: filePath() });
    await Promise.all([a.set("srv", "env:A", "1"), b.set("srv", "env:B", "2")]);

    const reader = new FileSecretStore({ filePath: filePath() });
    expect(await reader.get("srv", "env:A")).toBe("1");
    expect(await reader.get("srv", "env:B")).toBe("2");
  });

  it("keeps every entry when many independent stores write at once", async () => {
    const stores = Array.from(
      { length: 8 },
      () => new FileSecretStore({ filePath: filePath() }),
    );
    await Promise.all(stores.map((s, i) => s.set("srv", `env:K${i}`, `v${i}`)));

    const reader = new FileSecretStore({ filePath: filePath() });
    for (let i = 0; i < stores.length; i++) {
      expect(await reader.get("srv", `env:K${i}`)).toBe(`v${i}`);
    }
  });

  it("orders a delete and a set on the same file", async () => {
    const store = new FileSecretStore({ filePath: filePath() });
    await store.set("srv", "env:OLD", "x");

    const a = new FileSecretStore({ filePath: filePath() });
    const b = new FileSecretStore({ filePath: filePath() });
    await Promise.all([
      a.delete("srv", "env:OLD"),
      b.set("srv", "env:NEW", "y"),
    ]);

    const reader = new FileSecretStore({ filePath: filePath() });
    expect(await reader.get("srv", "env:OLD")).toBe(null);
    expect(await reader.get("srv", "env:NEW")).toBe("y");
  });
});

describe("cross-process convergence (optimistic verify-and-retry)", () => {
  // These drive the path the in-process queue cannot reach: a write landing
  // between our write and our verifying read, as a second Inspector would
  // produce it.

  it("re-applies onto the other writer's result when the verify sees a mismatch", async () => {
    const store = new FileSecretStore({ filePath: filePath() });
    await store.set("srv", "env:EXISTING", "0");
    injectOneExternalWrite(store, filePath(), {
      "srv:env:OTHER": "from-another-process",
    });

    await store.set("srv", "env:MINE", "1");

    // Our value survived *and* landed on top of theirs rather than replacing
    // it — which is the whole claim: the clobbered writer repairs it.
    const reader = new FileSecretStore({ filePath: filePath() });
    expect(await reader.get("srv", "env:MINE")).toBe("1");
    expect(await reader.get("srv", "env:OTHER")).toBe("from-another-process");
  });

  it("re-applies a delete against a concurrently rewritten file", async () => {
    const store = new FileSecretStore({ filePath: filePath() });
    await store.set("srv", "env:DOOMED", "x");
    injectOneExternalWrite(store, filePath(), {
      "srv:env:DOOMED": "x",
      "srv:env:OTHER": "from-another-process",
    });

    await store.delete("srv", "env:DOOMED");

    const reader = new FileSecretStore({ filePath: filePath() });
    expect(await reader.get("srv", "env:DOOMED")).toBe(null);
    expect(await reader.get("srv", "env:OTHER")).toBe("from-another-process");
  });

  it("converges through a scrypt derivation on every attempt", async () => {
    // The encrypted path re-derives per attempt, which is where the retry is
    // most expensive and the window widest.
    const opts = { filePath: filePath(), passphrase: "hunter2" };
    const store = new FileSecretStore(opts);
    await store.set("srv", "env:EXISTING", "0");
    // The intruder writes a *plaintext* envelope, as a differently
    // configured process would; the store must still read it and re-apply.
    injectOneExternalWrite(store, filePath(), {
      "srv:env:OTHER": "from-another-process",
    });

    await store.set("srv", "env:MINE", "1");

    const reader = new FileSecretStore(opts);
    expect(await reader.get("srv", "env:MINE")).toBe("1");
    expect(await reader.get("srv", "env:OTHER")).toBe("from-another-process");
  });

  // A writer that never wins. Simulated by replacing the file *behind* the
  // store immediately after each write — with a raw `fs` write rather than a
  // second store, because every store on this path now shares one in-process
  // queue and writing through one from inside a queued section would
  // deadlock on it.
  const clobberAfterEveryWrite = (store: FileSecretStore): void => {
    // Double cast, justified per the repo's TypeScript rules. The property
    // reached is `private`, so no single cast expresses it. What makes it
    // safe is that the asserted shape is `writeMap`'s real signature: the
    // replacement is checked against it, so a rename or a signature change
    // fails this line rather than silently leaving the stub detached and the
    // test passing for the wrong reason. The alternative — a production
    // injection seam — would add API surface existing only for this test,
    // and would let the real write path drift from the tested one, which is
    // precisely what this test exists to catch.
    const inner = store as unknown as {
      writeMap: (m: Record<string, string>) => Promise<void>;
    };
    const realWrite = inner.writeMap.bind(store);
    let n = 0;
    inner.writeMap = async (map: Record<string, string>) => {
      await realWrite(map);
      await fs.writeFile(
        filePath(),
        JSON.stringify({
          version: 1,
          encryption: "none",
          secrets: { "srv:env:INTRUDER": `v${n++}` },
        }),
        "utf-8",
      );
    };
  };

  it("reports non-convergence instead of silently dropping the value", async () => {
    // Returning after N attempts would reintroduce the silent loss with
    // extra steps, so this must reject — and say which value was not saved.
    const store = new FileSecretStore({ filePath: filePath() });
    clobberAfterEveryWrite(store);

    await expect(store.set("srv", "env:MINE", "1")).rejects.toThrow(
      /kept overwriting it/,
    );
  });

  it("resolves a delete once the clobbering writer removes the key itself", async () => {
    // The confirmed-delete contract: a delete resolves only when the key's
    // absence is confirmed, and throws when it cannot be (unreadable file,
    // held lock, non-convergence). Here the clobbering writer replaces the
    // file *without* the target key, so the retry finds nothing left to
    // delete — absence confirmed by someone else's hand is still absence,
    // and the delete resolves. A clobberer that kept the key present would
    // exhaust the retries and throw the non-convergence error, same as set.
    const store = new FileSecretStore({ filePath: filePath() });
    await store.set("srv", "env:A", "1");
    clobberAfterEveryWrite(store);

    await expect(store.delete("srv", "env:A")).resolves.toBeUndefined();
  });
});

describe("tightenSecretFilePermissions reports what it could not fix", () => {
  it("says absent when there is no file yet", async () => {
    expect(await tightenSecretFilePermissions(filePath())).toEqual({
      state: "absent",
    });
  });

  it("says ok once the file is 0600", async () => {
    const store = new FileSecretStore({ filePath: filePath() });
    await store.set("alpha", "env:A", "1");
    await fs.chmod(filePath(), 0o644);
    expect(await tightenSecretFilePermissions(filePath())).toEqual({
      state: "ok",
    });
  });
});

describe("resolveSecretPassphrase (MCP_INSPECTOR_SECRET_KEY_FILE, #2447)", () => {
  const keyFile = (): string => path.join(tmpDir, "secret-key");

  it("returns nothing when neither variable is set", () => {
    expect(resolveSecretPassphrase({})).toEqual({});
  });

  it("uses MCP_INSPECTOR_SECRET_KEY verbatim", () => {
    expect(
      resolveSecretPassphrase({ [SECRET_KEY_ENV]: " pass phrase " }),
    ).toEqual({ passphrase: " pass phrase " });
  });

  it("reads the key file, stripping only the trailing line break", async () => {
    await fs.writeFile(keyFile(), "  from file  \r\n\n");
    expect(
      resolveSecretPassphrase({ [SECRET_KEY_FILE_ENV]: keyFile() }),
    ).toEqual({ passphrase: "  from file  " });
  });

  it("treats a blank MCP_INSPECTOR_SECRET_KEY as unset, so the file is used", async () => {
    await fs.writeFile(keyFile(), "from-file\n");
    expect(
      resolveSecretPassphrase({
        [SECRET_KEY_ENV]: "  ",
        [SECRET_KEY_FILE_ENV]: keyFile(),
      }),
    ).toEqual({ passphrase: "from-file" });
  });

  it("resolves a relative key-file path against the working directory", async () => {
    await fs.writeFile(keyFile(), "relative\n");
    const relative = path.relative(process.cwd(), keyFile());
    expect(
      resolveSecretPassphrase({ [SECRET_KEY_FILE_ENV]: relative }),
    ).toEqual({ passphrase: "relative" });
  });

  it("refuses both variables at once rather than picking one", async () => {
    await fs.writeFile(keyFile(), "from-file\n");
    const result = resolveSecretPassphrase({
      [SECRET_KEY_ENV]: "direct",
      [SECRET_KEY_FILE_ENV]: keyFile(),
    });
    expect(result.passphrase).toBeUndefined();
    expect(result.problem).toMatch(
      /both MCP_INSPECTOR_SECRET_KEY and MCP_INSPECTOR_SECRET_KEY_FILE are set/,
    );
  });

  it("reports a missing key file as a problem, not as no passphrase", () => {
    const result = resolveSecretPassphrase({
      [SECRET_KEY_FILE_ENV]: path.join(tmpDir, "nope"),
    });
    expect(result.passphrase).toBeUndefined();
    expect(result.problem).toMatch(/could not be read: .*ENOENT/);
  });

  it("strips a lone trailing carriage return", async () => {
    await fs.writeFile(keyFile(), "classic-mac\r");
    expect(
      resolveSecretPassphrase({ [SECRET_KEY_FILE_ENV]: keyFile() }),
    ).toEqual({ passphrase: "classic-mac" });
  });

  it("reports a blank MCP_INSPECTOR_SECRET_KEY_FILE as a problem, not as unset", () => {
    // A template whose path did not expand must not quietly mean plaintext.
    const result = resolveSecretPassphrase({ [SECRET_KEY_FILE_ENV]: "  " });
    expect(result.passphrase).toBeUndefined();
    expect(result.problem).toBe(
      "MCP_INSPECTOR_SECRET_KEY_FILE is set but empty",
    );
  });

  it("still refuses both variables when the file variable is blank", () => {
    const result = resolveSecretPassphrase({
      [SECRET_KEY_ENV]: "direct",
      [SECRET_KEY_FILE_ENV]: "",
    });
    expect(result.passphrase).toBeUndefined();
    expect(result.problem).toMatch(/both .* are set/);
  });

  it("reports an empty key file as a problem", async () => {
    await fs.writeFile(keyFile(), "\n");
    const result = resolveSecretPassphrase({
      [SECRET_KEY_FILE_ENV]: keyFile(),
    });
    expect(result.passphrase).toBeUndefined();
    expect(result.problem).toMatch(/is empty/);
  });
});

describe("FileSecretStore with MCP_INSPECTOR_SECRET_KEY_FILE (#2447)", () => {
  const keyFile = (): string => path.join(tmpDir, "secret-key");

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("encrypts with the passphrase read from the file", async () => {
    await fs.writeFile(keyFile(), "hunter2\n");
    vi.stubEnv(SECRET_KEY_ENV, "");
    vi.stubEnv(SECRET_KEY_FILE_ENV, keyFile());
    const store = new FileSecretStore({ filePath: filePath() });
    expect(store.encrypted).toBe(true);
    expect(store.keyProblem).toBeUndefined();
    await store.set("alpha", "env:A", "super-secret");
    const raw = await fs.readFile(filePath(), "utf-8");
    expect(JSON.parse(raw).encryption).toBe("aes-256-gcm");
    // The same passphrase supplied directly opens it: the newline is not
    // part of the key.
    const direct = new FileSecretStore({
      filePath: filePath(),
      passphrase: "hunter2",
    });
    expect(await direct.get("alpha", "env:A")).toBe("super-secret");
  });

  it("refuses to write, rather than writing plaintext, when the key file is missing", async () => {
    vi.stubEnv(SECRET_KEY_ENV, "");
    vi.stubEnv(SECRET_KEY_FILE_ENV, path.join(tmpDir, "missing-key"));
    const store = new FileSecretStore({ filePath: filePath() });
    expect(store.encrypted).toBe(false);
    expect(store.keyProblem).toMatch(/could not be read/);
    await expect(store.set("alpha", "env:A", "v")).rejects.toThrow(
      SecretStoreUnavailableError,
    );
    await expect(store.set("alpha", "env:A", "v")).rejects.toThrow(
      /Refusing to read or write it rather than store secrets unencrypted/,
    );
    expect(existsSyncFile(filePath())).toBe(false);
    expect(await store.get("alpha", "env:A")).toBeNull();
    await expect(store.readAll()).rejects.toThrow(SecretStoreUnavailableError);
    expect(await store.readOnDiskEncryption()).toEqual({
      state: "unreadable",
      detail: expect.stringMatching(
        /MCP_INSPECTOR_SECRET_KEY_FILE .* could not be read/,
      ),
    });
  });

  it("leaves an existing file untouched while the key is unavailable", async () => {
    const plain = new FileSecretStore({ filePath: filePath() });
    await plain.set("alpha", "env:A", "1");
    const before = await fs.readFile(filePath(), "utf-8");
    vi.stubEnv(SECRET_KEY_ENV, "direct");
    vi.stubEnv(SECRET_KEY_FILE_ENV, keyFile());
    const store = new FileSecretStore({ filePath: filePath() });
    expect(store.keyProblem).toMatch(/both/);
    await expect(store.set("alpha", "env:B", "2")).rejects.toThrow(
      SecretStoreUnavailableError,
    );
    await expect(store.delete("alpha", "env:A")).rejects.toThrow(
      SecretStoreUnavailableError,
    );
    expect(await fs.readFile(filePath(), "utf-8")).toBe(before);
  });

  it("refuses a key file that is the secrets file itself", async () => {
    // Otherwise the plaintext JSON becomes the passphrase, the next save
    // replaces it with ciphertext, and the following start cannot open it.
    const plain = new FileSecretStore({ filePath: filePath() });
    await plain.set("alpha", "env:A", "1");
    const before = await fs.readFile(filePath(), "utf-8");
    vi.stubEnv(SECRET_KEY_ENV, "");
    vi.stubEnv(SECRET_KEY_FILE_ENV, filePath());
    const store = new FileSecretStore({ filePath: filePath() });
    expect(store.keyProblem).toMatch(/is the secrets file itself/);
    await expect(store.set("alpha", "env:B", "2")).rejects.toThrow(
      SecretStoreUnavailableError,
    );
    expect(await fs.readFile(filePath(), "utf-8")).toBe(before);
  });

  it("refuses a symlink or hard link to the secrets file", async () => {
    await fs.writeFile(filePath(), "{}\n");
    const link = path.join(tmpDir, "key-symlink");
    const hard = path.join(tmpDir, "key-hardlink");
    await fs.symlink(filePath(), link);
    await fs.link(filePath(), hard);
    for (const keyPath of [link, hard]) {
      expect(
        resolveSecretPassphrase({ [SECRET_KEY_FILE_ENV]: keyPath }, filePath())
          .problem,
      ).toMatch(/is the secrets file itself/);
    }
  });

  it("matches by path when the secrets file does not exist yet", () => {
    const result = resolveSecretPassphrase(
      { [SECRET_KEY_FILE_ENV]: filePath() },
      filePath(),
    );
    expect(result.problem).toMatch(/is the secrets file itself/);
  });

  it("an explicit passphrase option ignores the environment", () => {
    vi.stubEnv(SECRET_KEY_FILE_ENV, path.join(tmpDir, "missing-key"));
    const store = new FileSecretStore({
      filePath: filePath(),
      passphrase: "hunter2",
    });
    expect(store.keyProblem).toBeUndefined();
    expect(store.encrypted).toBe(true);
  });
});
