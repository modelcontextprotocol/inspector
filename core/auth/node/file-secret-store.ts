/**
 * File-backed {@link SecretStore} — the persistence answer for a box with
 * no reachable OS keychain (#1950): the published container (no D-Bus
 * session, #1848), Android/Termux (no platform binary, #1905), and a
 * minimal Linux install without libsecret.
 *
 * **This partially reverses #1356 on purpose.** That change moved
 * `oauthClientSecret` *out of* `mcp.json` and into the keychain to get it
 * off disk. Writing secrets back to disk here is therefore a decision, not
 * an oversight, and it is bounded three ways: the file is separate from
 * `mcp.json` (so a user pasting their catalog into an issue does not paste
 * their secrets), it is written `0600`, and it is encrypted whenever
 * `MCP_INSPECTOR_SECRET_KEY` is set. What it buys is the alternative:
 * before this, those users could not persist a secret at all — `set` threw
 * and the route answered 503.
 *
 * **Format.** One JSON document, whose whole secret map is encrypted as a
 * unit rather than value-by-value:
 *
 * ```json
 * { "version": 1, "encryption": "none", "secrets": { "srv:field": "s3cr3t" } }
 * { "version": 1, "encryption": "aes-256-gcm",
 *   "kdf": { "algorithm": "scrypt", "salt": "…", "N": 16384, "r": 8, "p": 1 },
 *   "data": "<iv>.<authTag>.<ciphertext>" }
 * ```
 *
 * Encrypting the map as a unit — not each value — is what hides the
 * *account names* too. Those are `${serverId}:${field}`, so a per-value
 * scheme would leave a readable index of which servers you use and which
 * of them you hold an OAuth client secret for. That index is worth
 * roughly as much to an attacker as some of the values.
 *
 * **Key.** `MCP_INSPECTOR_SECRET_KEY` is a passphrase, not a key: it is
 * stretched with scrypt against a per-file random salt stored beside the
 * ciphertext, so the same passphrase produces a different key for a
 * different file and a precomputed table buys an attacker nothing.
 *
 * That is **not** a licence to use a short, memorable one. The salt
 * defeats precomputation; it does nothing against guessing, and the cost
 * parameters below are deliberately cheap (a few milliseconds, since the
 * derivation runs on every read and write). Anyone who steals
 * `secrets.json` can therefore try candidate passphrases quickly and
 * offline. Use a high-entropy value — generated, not chosen — the same as
 * you would for any other credential.
 *
 * **Availability contract — identical to `KeyringSecretStore`'s**, because
 * callers must not have to know which store they got. `get` is tolerant
 * (returns `null` on any failure), `delete` no-ops, and `set` is the only
 * operation that hard-fails, throwing {@link SecretStoreUnavailableError}
 * — the moment where a value would actually be lost. Routes translate that
 * to a 503 the same way they already do for the keychain.
 *
 * The one failure worth calling out is the *key mismatch*: a file written
 * encrypted, opened later with the passphrase changed or removed. Reads go
 * quiet (`null`, per the contract) but writes must not — writing would
 * replace a file full of still-valid secrets with one holding a single new
 * one, destroying data to satisfy a request that was only ever additive.
 * So `set` refuses and says which of the two things to fix.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readStoreFile, writeStoreFile } from "../../storage/store-io.js";
import {
  SecretStoreUnavailableError,
  type SecretStore,
} from "./secret-store.js";

/**
 * Promisified `scrypt`. Hand-wrapped rather than `promisify`d because the
 * overload carrying the cost parameters is not the one `promisify`'s types
 * pick up, and the alternative — `scryptSync` — blocks the event loop for
 * the duration of the derivation on every read and write.
 */
const scrypt = (
  passphrase: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    crypto.scrypt(passphrase, salt, keylen, options, (err, key) => {
      /* v8 ignore next -- @preserve: node validates the cost parameters
         synchronously (an out-of-grammar `N` throws from the call itself,
         which the corrupt-KDF test exercises), so this asynchronous channel
         is left for allocation failure — not provokable deterministically. */
      if (err) reject(err);
      else resolve(key);
    });
  });

const FORMAT_VERSION = 1;
const CIPHER = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
/** AES-GCM authentication tag length, in bytes. */
const GCM_TAG_BYTES = 16;
/** scrypt defaults. `N` is the only one that meaningfully costs time; 2^14
 * derives in a few milliseconds, which is invisible next to the file I/O it
 * accompanies and is derived once per read/write rather than per secret. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/** Env var holding the passphrase. Absent → the file is written in the clear. */
export const SECRET_KEY_ENV = "MCP_INSPECTOR_SECRET_KEY";

interface KdfParams {
  algorithm: "scrypt";
  salt: string;
  N: number;
  r: number;
  p: number;
}

interface SecretFile {
  version: number;
  encryption: "none" | "aes-256-gcm";
  kdf?: KdfParams;
  secrets?: Record<string, string>;
  data?: string;
}

const buildAccount = (serverId: string, field: string): string =>
  `${serverId}:${field}`;

/**
 * Assert that a decoded payload really is a `Record<string, string>`.
 *
 * Neither branch of {@link FileSecretStore.readMap} can trust its input: the
 * plaintext `secrets` field is whatever the file says, and a decrypted
 * payload only proves the *bytes* were authentic — GCM verifies who wrote
 * them, not what shape they parse to.
 *
 * An array is the case that shows why a cast is not enough. `[]` passes
 * `typeof === "object"`, so `map[account] = value` assigns a named property
 * to it, and `JSON.stringify` then drops every named property of an array —
 * so `set` resolves successfully having written a file that does not contain
 * the secret it was given. Silent loss on the one operation whose entire
 * contract is that it does not lose things.
 */
function asSecretMap(value: unknown, filePath: string): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SecretStoreUnavailableError(
      `The secrets file at ${filePath} does not hold a secret map (found ${Array.isArray(value) ? "an array" : typeof value}). Refusing to write, which would replace it. Move the file aside to start over.`,
    );
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new SecretStoreUnavailableError(
        `The secrets file at ${filePath} holds a non-string value for "${key}". Refusing to write, which would replace it. Move the file aside to start over.`,
      );
    }
  }
  return { ...(value as Record<string, string>) };
}

/**
 * Thrown when a file was written encrypted and the current passphrase
 * cannot open it. A distinct type so `set` can refuse with advice that
 * fits, instead of the generic "could not write" that would send someone
 * looking at permissions.
 */
export class SecretFileKeyMismatchError extends SecretStoreUnavailableError {
  constructor(filePath: string, hasKey: boolean) {
    super(
      hasKey
        ? `The secrets file at ${filePath} could not be decrypted with the current ${SECRET_KEY_ENV}. Refusing to write, which would overwrite the existing secrets. Restore the original passphrase, or delete the file to start over.`
        : `The secrets file at ${filePath} is encrypted but ${SECRET_KEY_ENV} is not set. Refusing to write, which would overwrite the existing secrets. Set the passphrase this file was written with, or delete the file to start over.`,
    );
    this.name = "SecretFileKeyMismatchError";
  }
}

const encodeParts = (iv: Buffer, tag: Buffer, body: Buffer): string =>
  `${iv.toString("base64")}.${tag.toString("base64")}.${body.toString("base64")}`;

/**
 * Split a `<iv>.<tag>.<ciphertext>` payload, rejecting anything that is not
 * exactly three parts. `split(".")` on a truncated or extended payload
 * otherwise yields buffers of the wrong length, and `createDecipheriv`
 * reports that as a generic error further away from the cause.
 */
function decodeParts(
  payload: string,
): { iv: Buffer; tag: Buffer; body: Buffer } | null {
  const parts = payload.split(".");
  if (parts.length !== 3) return null;
  const [iv, tag, body] = parts as [string, string, string];
  return {
    iv: Buffer.from(iv, "base64"),
    tag: Buffer.from(tag, "base64"),
    body: Buffer.from(body, "base64"),
  };
}

/**
 * How many times a mutation will re-apply itself before giving up.
 *
 * Each attempt is a full read-modify-write plus a verifying read, so the
 * bound is on *rounds lost to another writer*, not on retries of a failing
 * operation. Two Inspector processes writing the same file at the same
 * instant is already rare; losing five consecutive rounds to one means
 * something other than ordinary contention is happening, and reporting that
 * is more honest than looping.
 */
const MAX_WRITE_ATTEMPTS = 5;

/**
 * In-process mutation queues, one per resolved secrets-file path.
 *
 * Process-wide rather than per-store: see `FileSecretStore.serialize`.
 */
const fileQueues = new Map<string, Promise<unknown>>();

/** Do two secret maps hold exactly the same entries? */
function sameMap(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every(
    (k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k],
  );
}

/**
 * What the secrets file's envelope says, or why it could not be read.
 * `absent` is "nothing written yet"; `unreadable` is "there is a file and
 * we cannot tell" — two very different things to say to a user.
 */
export type SecretFileEncryptionState =
  | { state: "absent" }
  | { state: "plaintext" }
  | { state: "encrypted" }
  | { state: "unreadable"; detail: string };

/** A positive, finite integer? */
const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

/**
 * Why this encrypted envelope could not be opened, or `null` if it can.
 *
 * Everything `readMap` needs before it reaches `createDecipheriv`, checked
 * in the same order it would fail: the parts, then their sizes, then the
 * derivation parameters. `scrypt` validates its own cost parameters
 * *synchronously*, so `N: 3` throws out of the derivation rather than
 * arriving as a decrypt failure — which is why they are checked here rather
 * than left to the cipher.
 */
function encryptedEnvelopeProblem(parsed: SecretFile): string | null {
  if (!parsed.kdf || typeof parsed.data !== "string") {
    return "encrypted envelope is missing its kdf or data";
  }
  const parts = decodeParts(parsed.data);
  if (!parts) return "encrypted payload is not iv.tag.ciphertext";
  if (parts.iv.length !== IV_BYTES) {
    return `initialization vector is ${parts.iv.length} bytes, expected ${IV_BYTES}`;
  }
  if (parts.tag.length !== GCM_TAG_BYTES) {
    return `authentication tag is ${parts.tag.length} bytes, expected ${GCM_TAG_BYTES}`;
  }
  if (parts.body.length === 0) return "ciphertext is empty";
  const { algorithm, salt, N, r, p } = parsed.kdf;
  if (algorithm !== "scrypt") return `unsupported kdf "${String(algorithm)}"`;
  if (typeof salt !== "string" || Buffer.from(salt, "base64").length === 0) {
    return "kdf salt is missing or not base64";
  }
  // `N` must be a power of two greater than 1; node rejects anything else.
  if (!isPositiveInt(N) || N < 2 || (N & (N - 1)) !== 0) {
    return `kdf N is ${String(N)}, which is not a power of two above 1`;
  }
  if (!isPositiveInt(r) || !isPositiveInt(p)) {
    return `kdf r/p are ${String(r)}/${String(p)}, which are not positive integers`;
  }
  return null;
}

export interface FileSecretStoreOptions {
  /** Absolute path of the secrets file. */
  filePath: string;
  /**
   * Passphrase. Defaults to `process.env[SECRET_KEY_ENV]`; an empty or
   * whitespace-only value counts as absent, since `MCP_INSPECTOR_SECRET_KEY=`
   * in a compose file is a user who meant "off", not a one-character key.
   */
  passphrase?: string;
}

export class FileSecretStore implements SecretStore {
  readonly filePath: string;
  private readonly passphrase: string | undefined;
  constructor(options: FileSecretStoreOptions) {
    this.filePath = options.filePath;
    const raw = options.passphrase ?? process.env[SECRET_KEY_ENV];
    this.passphrase = raw && raw.trim() ? raw : undefined;
  }

  /**
   * True when the *next write* will encrypt. This is the configured policy,
   * not the state of the file — see {@link readOnDiskEncryption}, which is
   * what the user-facing descriptor is built from.
   */
  get encrypted(): boolean {
    return this.passphrase !== undefined;
  }

  /**
   * What the file on disk is *currently* written as — `null` when there is
   * no file yet, or when it cannot be read or parsed.
   *
   * Separate from {@link encrypted} because the two genuinely disagree for a
   * whole session: adding `MCP_INSPECTOR_SECRET_KEY` to an install that
   * already has a plaintext file flips `encrypted` to true immediately,
   * while the bytes stay readable until the next `set`. A descriptor built
   * from the policy would tell that user "File (encrypted)" while their
   * existing secrets sat in the clear — the precise reassurance this whole
   * subsystem exists not to give.
   *
   * Reads the envelope only. It never decrypts, so it needs no passphrase
   * and answers correctly even when the key is wrong or missing — which is
   * also a state the UI has to describe rather than throw on.
   *
   * `absent` and `unreadable` are kept apart deliberately. Collapsing them
   * (as a bare `null` did) means an existing file that is corrupt, or
   * written in an envelope this build does not know, is reported as "no
   * file yet" — and the descriptor then falls back to the configured write
   * policy, so a passphrase-configured install claims "Encrypted file"
   * about a file whose encryption state was never established and which
   * `set` is in fact about to refuse.
   */
  async readOnDiskEncryption(): Promise<SecretFileEncryptionState> {
    let raw: string | null;
    try {
      raw = await readStoreFile(this.filePath);
    } catch (err) {
      return {
        state: "unreadable",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
    if (raw === null) return { state: "absent" };
    try {
      const parsed = JSON.parse(raw) as SecretFile;
      // Version before mode, matching `readMap`. A version this build does
      // not understand is refused there, so presenting such a file as a
      // usable "plaintext" or "encrypted" store would describe it as working
      // while every save fails.
      if (parsed.version !== FORMAT_VERSION) {
        return {
          state: "unreadable",
          detail: `format version ${String(parsed.version)}, expected ${FORMAT_VERSION}`,
        };
      }
      if (parsed.encryption === "none") return { state: "plaintext" };
      if (parsed.encryption === CIPHER) {
        // Naming the cipher is not the same as being openable, and a partial
        // check is its own trap: three dot-separated strings satisfy
        // `decodeParts` while an empty tag, a 4-byte IV or `N: 3` still make
        // every decrypt throw. Reporting "encrypted" then gives the quiet,
        // reassuring footer to a file whose very next save is guaranteed to
        // fail, which is the one thing this state exists to prevent.
        const problem = encryptedEnvelopeProblem(parsed);
        if (problem) return { state: "unreadable", detail: problem };
        // Structure is not access. A well-formed envelope this passphrase
        // cannot open reads as `null` from every `get` and refuses every
        // `set` — so classifying it "encrypted" hands the quiet, healthy
        // footer to the exact state the unreadable one promises to warn
        // about, and the user finds out when their save fails. Authenticate
        // it: decrypt and discard. Costs one scrypt derivation (~23ms) per
        // descriptor build, which is once per `/api/config`, and buys the
        // difference between describing the file and merely describing its
        // shape.
        try {
          await this.readMap();
        } catch (err) {
          return {
            state: "unreadable",
            detail:
              err instanceof SecretFileKeyMismatchError
                ? `it cannot be decrypted with the current ${SECRET_KEY_ENV}`
                : err instanceof Error
                  ? err.message
                  : String(err),
          };
        }
        return { state: "encrypted" };
      }
      return {
        state: "unreadable",
        detail: `unsupported envelope (encryption="${String(parsed.encryption)}", version=${String(parsed.version)})`,
      };
    } catch {
      return { state: "unreadable", detail: "not valid JSON" };
    }
  }

  private async deriveKey(kdf: KdfParams): Promise<Buffer> {
    return scrypt(
      // Only reached when the passphrase is set — every caller checks first,
      // which is what makes the non-null assertion safe here rather than a
      // widened `string | undefined` threaded through the crypto helpers.
      this.passphrase as string,
      Buffer.from(kdf.salt, "base64"),
      KEY_BYTES,
      { N: kdf.N, r: kdf.r, p: kdf.p },
    );
  }

  /**
   * Read and decode the file into a plain map.
   *
   * Distinguishes three outcomes that callers treat differently: `null` for
   * "no file yet" (a first write should create one), a map for success, and a
   * throw for "there is a file and we cannot read it" — which must never be
   * flattened into an empty map, or `set` would cheerfully overwrite it.
   */
  /**
   * Every secret in the file, keyed by `${serverId}:${field}` — `null` when
   * there is no file.
   *
   * Exists for one caller: the hand-off performed when a keychain becomes
   * available on a box that had been falling back to a file (see
   * `absorbFileSecretsIntoKeyring`). Nothing in the normal request path
   * enumerates secrets, and deliberately so — this is the widest possible
   * read of the store and it should stay a one-purpose seam rather than a
   * general convenience.
   *
   * Throws for the same reasons `get` swallows: an unreadable or
   * undecryptable file must not present as "no secrets", because the caller
   * would conclude there was nothing to migrate and move on.
   */
  async readAll(): Promise<Record<string, string> | null> {
    return this.serialize(() => this.readMap());
  }

  private async readMap(): Promise<Record<string, string> | null> {
    const raw = await readStoreFile(this.filePath);
    if (raw === null) return null;

    let parsed: SecretFile;
    try {
      parsed = JSON.parse(raw) as SecretFile;
    } catch (err) {
      throw new SecretStoreUnavailableError(
        `The secrets file at ${this.filePath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Version first, before either branch. A `{ version: 2, encryption:
    // "none" }` file is readable as far as the plaintext branch is concerned,
    // but reading it means the next write rewrites it as version 1 — silently
    // discarding whatever fields version 2 added. That is exactly the
    // destroy-to-satisfy-an-additive-request case the encrypted branch already
    // refuses, so it gets the same answer rather than a different one that
    // happens to depend on which encryption mode the newer writer chose.
    if (parsed.version !== FORMAT_VERSION) {
      throw new SecretStoreUnavailableError(
        `The secrets file at ${this.filePath} declares format version ${String(parsed.version)}, but this Inspector only understands version ${FORMAT_VERSION}. It was probably written by a newer Inspector; upgrade, or move the file aside to start over.`,
      );
    }

    if (parsed.encryption === "none") {
      // A plaintext file read by a store that now has a passphrase is fine and
      // deliberately not an error: the next write re-encrypts it, so setting
      // the env var upgrades an existing file in place. Until that write
      // lands the file really is still readable, which is why
      // `readOnDiskEncryption` exists — the descriptor must report the file,
      // not the intent.
      return asSecretMap(parsed.secrets ?? {}, this.filePath);
    }

    if (parsed.encryption !== CIPHER || !parsed.kdf || !parsed.data) {
      throw new SecretStoreUnavailableError(
        `The secrets file at ${this.filePath} declares an unsupported format (encryption="${String(parsed.encryption)}", version=${String(parsed.version)}). It may have been written by a newer Inspector.`,
      );
    }
    if (!this.passphrase)
      throw new SecretFileKeyMismatchError(this.filePath, false);

    const parts = decodeParts(parsed.data);
    if (!parts) throw new SecretFileKeyMismatchError(this.filePath, true);
    try {
      const key = await this.deriveKey(parsed.kdf);
      const decipher = crypto.createDecipheriv(CIPHER, key, parts.iv);
      decipher.setAuthTag(parts.tag);
      const plain = Buffer.concat([
        decipher.update(parts.body),
        decipher.final(),
      ]).toString("utf-8");
      return asSecretMap(JSON.parse(plain), this.filePath);
    } catch (err) {
      // A shape refusal is about the *contents*, not the key — it decrypted
      // fine. Rethrowing it as a key mismatch would send the user to fix a
      // passphrase that is working.
      if (err instanceof SecretStoreUnavailableError) throw err;
      // GCM authentication failure is what a wrong passphrase looks like, and
      // it is indistinguishable from a tampered/corrupt file — both mean "this
      // key does not open this file", which is what the message says.
      throw new SecretFileKeyMismatchError(this.filePath, true);
    }
  }

  private async writeMap(map: Record<string, string>): Promise<void> {
    let file: SecretFile;
    if (this.passphrase) {
      const kdf: KdfParams = {
        algorithm: "scrypt",
        // A fresh salt per write, not per file: rewriting with the same salt
        // and a fresh IV would still be safe for GCM, but re-salting costs one
        // scrypt derivation we were doing anyway and removes the question.
        salt: crypto.randomBytes(16).toString("base64"),
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
      };
      const key = await this.deriveKey(kdf);
      const iv = crypto.randomBytes(IV_BYTES);
      const cipher = crypto.createCipheriv(CIPHER, key, iv);
      const body = Buffer.concat([
        cipher.update(JSON.stringify(map), "utf-8"),
        cipher.final(),
      ]);
      file = {
        version: FORMAT_VERSION,
        encryption: CIPHER,
        kdf,
        data: encodeParts(iv, cipher.getAuthTag(), body),
      };
    } else {
      file = { version: FORMAT_VERSION, encryption: "none", secrets: map };
    }
    // `writeStoreFile` creates the parent dir, writes atomically, and sets
    // 0600 — the same helper the OAuth token store uses, so the two files on
    // disk have identical permissions by construction rather than by
    // convention.
    await writeStoreFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`);
  }

  /**
   * Run `fn` with the file to itself across *processes* as well.
   *
   * The in-process queue is necessary and not sufficient: a durable secrets
   * file is shared state, and a second Inspector on the same box — a CLI run
   * beside a web session is the ordinary case, not a contrived one — reads
   * the same "before" map and then atomically replaces the file, dropping
   * whatever the first process had just added. Both writes report success;
   * one secret is simply gone.
   *
   * Apply a mutation to the file, and confirm it survived.
   *
   * **There is no cross-process lock.** There was one — a `mkdir` election
   * with an owner stamp, a heartbeat and a stale-takeover — and three
   * consecutive review rounds found a real race in it. The last one is
   * unfixable with what Node exposes: claiming a stale lock needs
   * compare-and-swap on a directory entry (`renameat2(RENAME_EXCHANGE)`),
   * and without it a waiter that loses the race can still move the winner's
   * *fresh* lock aside and enter alongside it.
   *
   * So this does the opposite: it lets writers collide and makes the loser
   * notice. Read `M0`, apply the mutation to get `M1`, write it, then read
   * back `M2`. If `M2` equals `M1` nothing interleaved. If it does not,
   * someone wrote between our write and our read — so re-apply onto what
   * they left and try again.
   *
   * The comparison is over the **whole map**, not just the entry we touched.
   * Checking only our own key would pass in precisely the case that loses
   * data: our entry is present, and it is the *other* writer's that is gone.
   * When the verify does fire, the writer that was clobbered is the one that
   * repairs it — A writes `MA`, B writes `MB` over it, B verifies `MB`
   * correctly, A verifies, sees `M2 !== MA`, re-applies onto `MB`.
   *
   * **This is not mutual exclusion, and the gap is wider than a crash.**
   * The verify only catches a clobber that has already landed. Order the
   * same two writers as write-A, verify-A, write-B, verify-B and both
   * succeed while A's entry is gone: A's verify ran before B's write, so
   * there was nothing yet to see, and B did nothing wrong. Nothing detects
   * it afterwards. A crash between write and verify is one instance of the
   * same shape, not the whole of it — an earlier version of this comment
   * said otherwise, which understated it.
   *
   * What that buys, stated without overselling: two processes must write the
   * same file within the window between one's write and its read-back, and
   * the loss is one secret that reported success. The lock this replaced
   * lost updates in a *wider* set of interleavings, with every participant
   * alive, and could not be closed without a primitive Node does not expose
   * (`renameat2(RENAME_EXCHANGE)`); this costs ~220 fewer lines and converges
   * in every interleaving where the clobber lands before the verify. If the
   * residual matters for a deployment, the answer is a real lock — an
   * OS-backed one from a dedicated library — not another hand-rolled
   * election.
   *
   * Reads deliberately do not participate: `writeStoreFile` is atomic
   * (write-temp-then-rename), so a reader sees either the old file or the
   * new one, never a torn one.
   */
  private async mutate(
    apply: (map: Record<string, string>) => Record<string, string> | null,
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      let current: Record<string, string>;
      try {
        current = (await this.readMap()) ?? {};
      } catch (err) {
        // Already a typed refusal (unreadable file / key mismatch) —
        // rethrow rather than re-wrapping, so the specific advice survives.
        if (err instanceof SecretStoreUnavailableError) throw err;
        throw new SecretStoreUnavailableError(
          `Could not read the secrets file at ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const next = apply(current);
      // `null` means "nothing to do" — a delete that matched no entry. No
      // write, so nothing to verify.
      if (next === null) return;
      try {
        await this.writeMap(next);
      } catch (err) {
        throw new SecretStoreUnavailableError(
          `Could not write the secrets file at ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      let observed: Record<string, string>;
      try {
        observed = (await this.readMap()) ?? {};
      } catch {
        // We wrote successfully and cannot read it back — most likely
        // another writer replaced it with something this passphrase cannot
        // open. Retrying would not help and claiming success would be a
        // guess, so fall through to the non-convergence error below.
        continue;
      }
      if (sameMap(next, observed)) return;
      // Someone wrote between our write and our read. Loop: `apply` runs
      // again against what they left.
    }
    throw new SecretStoreUnavailableError(
      `Could not write the secrets file at ${this.filePath}: another process kept overwriting it (gave up after ${MAX_WRITE_ATTEMPTS} attempts). Its secrets are intact; the value you just entered was not saved.`,
    );
  }

  /**
   * Run `fn` with the file to itself, so concurrent callers can't lose
   * writes.
   *
   * Keyed on the **resolved path, process-wide** rather than on this
   * instance. Two `FileSecretStore`s pointing at one file are ordinary —
   * the resolved store holds one and `absorbFileSecretsIntoKeyring`
   * constructs another — and a per-instance queue does not order them
   * against each other at all. They then race in-process, which the
   * optimistic verify is only *supposed* to catch for writers in different
   * processes: both read the same map, both write, and whichever verifies
   * before the other's write lands sees its own value and returns happy.
   * Measured, not theorised — two instances racing `set` lost an entry on
   * the first run of the convergence test below.
   *
   * So the in-process case is made correct by construction here, and the
   * verify-and-retry in {@link mutate} covers what this cannot see: a
   * second Inspector process.
   */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const key = path.resolve(this.filePath);
    const run = (fileQueues.get(key) ?? Promise.resolve()).then(fn);
    // Swallow on the chain only — the returned promise still rejects, so a
    // failed `set` surfaces to its caller while a later `set` is not poisoned
    // by it. This assignment is also why `this.queue` needs no `.catch()` of
    // its own above: it is only ever `Promise.resolve()` or an
    // already-swallowed promise, so it cannot reject.
    const settled = run.then(
      () => {},
      () => {},
    );
    fileQueues.set(key, settled);
    // Drop the entry once it is the tail, so a long-lived process does not
    // accumulate one resolved promise per file it has ever touched.
    void settled.then(() => {
      if (fileQueues.get(key) === settled) fileQueues.delete(key);
    });
    return run;
  }

  /**
   * One read and one derivation for a whole server's fields.
   *
   * The reason this exists: `get` reads and decrypts the entire file, and
   * the rehydration callers ask field by field — so an encrypted catalog
   * paid N scrypt derivations per server, serialized behind this store's own
   * queue, every time the server list was loaded. Tolerant like `get`: an
   * unreadable store yields no fields rather than throwing.
   */
  async getMany(
    serverId: string,
    fields: string[],
  ): Promise<Record<string, string>> {
    let map: Record<string, string> | null;
    try {
      map = await this.serialize(() => this.readMap());
    } catch {
      return {};
    }
    if (!map) return {};
    const out: Record<string, string> = {};
    for (const field of fields) {
      const value = map[buildAccount(serverId, field)];
      if (value !== undefined) out[field] = value;
    }
    return out;
  }

  /**
   * The intolerant read — same lookup as {@link get}, minus the catch.
   *
   * Without this, `secretStoreGetStrict` fell back to `get` for the file
   * store and turned every read failure into `null`. Both plaintext
   * migrations *write* on `null` and then strip the disk copy, so a
   * transient read error that cleared before the write let an older
   * on-disk value replace a newer stored one — the same inversion the
   * strict seam was introduced to prevent, still open on the store the
   * seam was introduced for.
   */
  async getStrict(serverId: string, field: string): Promise<string | null> {
    try {
      const map = await this.serialize(() => this.readMap());
      return map?.[buildAccount(serverId, field)] ?? null;
    } catch (err) {
      // Typed refusals (key mismatch, unsupported envelope) already carry
      // the advice that fits; anything else is a filesystem failure that
      // must still reach the caller as something it knows to catch.
      if (err instanceof SecretStoreUnavailableError) throw err;
      throw new SecretStoreUnavailableError(
        `Could not read the secrets file at ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async get(serverId: string, field: string): Promise<string | null> {
    try {
      const map = await this.serialize(() => this.readMap());
      return map?.[buildAccount(serverId, field)] ?? null;
    } catch {
      // Read tolerance, matching `KeyringSecretStore.get`: an unreadable store
      // and an absent entry are the same answer to the caller, and hard-failing
      // here would break every `GET /api/servers` on a box whose passphrase
      // changed.
      return null;
    }
  }

  async set(serverId: string, field: string, value: string): Promise<void> {
    await this.serialize(() =>
      this.mutate((map) => ({
        ...map,
        [buildAccount(serverId, field)]: value,
      })),
    );
  }

  async delete(serverId: string, field: string): Promise<void> {
    await this.deleteWhere((key) => key === buildAccount(serverId, field));
  }

  async deleteAllForServer(serverId: string): Promise<void> {
    const prefix = `${serverId}:`;
    await this.deleteWhere((key) => key.startsWith(prefix));
  }

  /**
   * Shared delete body. Silent on every failure, matching the keyring store:
   * every reason a delete can fail collapses to "the entry isn't there
   * anymore", and `set` is the operation that reports a broken store.
   */
  private async deleteWhere(match: (key: string) => boolean): Promise<void> {
    try {
      await this.serialize(() =>
        this.mutate((map) => {
          const keys = Object.keys(map).filter(match);
          if (keys.length === 0) return null;
          const next = { ...map };
          for (const key of keys) delete next[key];
          // An emptied map keeps the file rather than unlinking it: its
          // presence is what records which encryption mode this install
          // settled on, so a later write can't silently switch modes on the
          // user.
          return next;
        }),
      );
    } catch {
      // Intentionally silent — see the doc comment above.
    }
  }
}

/**
 * Best-effort permission repair for a pre-existing secrets file.
 *
 * A no-op in effect on Windows, where `chmod` cannot express "owner only"
 * — {@link readSecretFilePermissions} reports `unknown` there rather than
 * interpreting the synthetic mode bits.
 *
 * `writeStoreFile` writes through `atomically`, which creates a temp file
 * with `mode: 0o600` and renames it over the destination — so every *write*
 * re-establishes the mode regardless of what the old file had. What it
 * cannot fix is a file that is never written: one made `0644` by hand,
 * restored from a backup, or copied out of an image is read at that mode
 * indefinitely. Called once at store selection to close exactly that gap.
 *
 * Failures are swallowed: a file we cannot chmod is one we probably cannot
 * write either, and `set` is where that gets reported with context.
 */
export async function tightenSecretFilePermissions(
  filePath: string,
): Promise<SecretFilePermissionState> {
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // Non-existent (the common case — nothing written yet), read-only mount,
    // or a platform without POSIX modes. The verification below decides
    // whether that mattered.
  }
  // Verify rather than assume. The chmod above is best-effort, but the UI and
  // the README both state the file is 0600 — so a file we failed to tighten
  // (owned by another user, on a read-only mount) must be reported, not
  // quietly described as protected.
  return readSecretFilePermissions(filePath);
}

/**
 * Read the file's permission state **without touching it**.
 *
 * The read-only half of {@link tightenSecretFilePermissions}, split out
 * because the descriptor is rebuilt on every `GET /api/config` and a
 * function whose job is to *describe* must not chmod as a side effect —
 * once per page load, on a file another process may be mid-write on. The
 * repair belongs at startup, where it happens once and its outcome is
 * announced; from then on the question is only "what is the mode now".
 */
export async function readSecretFilePermissions(
  filePath: string,
): Promise<SecretFilePermissionState> {
  try {
    // Windows does not model POSIX modes. `stat` still returns *something*
    // — synthetic bits derived from the read-only attribute — and reading
    // them as a permission statement produces a confident falsehood either
    // way: "0666 — not owner-only" about a file the ACL may well restrict,
    // or "owner-only" about one it does not. The real answer lives in the
    // ACL, which this does not inspect, so the honest report is that we did
    // not check.
    if (process.platform === "win32") {
      await fs.stat(filePath); // still distinguishes absent from present
      return { state: "unknown", detail: "not checked on Windows" };
    }
    const mode = (await fs.stat(filePath)).mode & 0o777;
    if (mode === 0o600) return { state: "ok" };
    return { state: "loose", mode };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // No file yet — the common first run. `writeStoreFile` creates it
      // 0600, so there is nothing to warn about.
      return { state: "absent" };
    }
    // The file exists and we could not inspect it (EACCES on the directory,
    // a permission-less filesystem). Collapsing this into "absent" is what
    // makes it dangerous: the descriptor then omits the warning and the
    // footer goes on stating mode 0600 as fact, having verified nothing.
    // "Unknown" is the honest third answer.
    return { state: "unknown", detail: code ?? "unknown error" };
  }
}

/**
 * Outcome of {@link tightenSecretFilePermissions} and
 * {@link readSecretFilePermissions}: the file is `0600`
 * (`ok`), does not exist yet (`absent`), or exists with a wider mode we
 * could not fix (`loose`) — the only case anyone needs to hear about.
 */
export type SecretFilePermissionState =
  | { state: "ok" }
  | { state: "absent" }
  | { state: "loose"; mode: number }
  /** The file is there and its mode could not be read — see above. */
  | { state: "unknown"; detail: string };
