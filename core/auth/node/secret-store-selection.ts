/**
 * Which {@link SecretStore} this process uses, and how the user finds out
 * (#1950).
 *
 * ## The policy
 *
 * `MCP_INSPECTOR_SECRET_STORE=keyring|file|memory` wins outright. With it
 * unset:
 *
 * 1. Probe the OS keychain. Reachable → use it. This is the overwhelming
 *    majority of runs and nothing changes for them.
 * 2. Unreachable → fall back, **loudly**. Which way we fall back depends
 *    on whether the file we would write is going to survive:
 *    - in a container whose secrets directory is *not* on a mount →
 *      `memory`;
 *    - otherwise → `file`.
 *
 * ## Why automatic
 *
 * Automatic fallback silently changes where a secret lives, which is a
 * real objection to make of a security-adjacent tool. But the objection
 * is to *silently*, not to *automatic*: requiring an env var before any
 * persistence works at all means the container user's first encounter is
 * a 503 with no hint that a working configuration exists — and the store
 * they would then be told to set is the one this code would have picked
 * anyway. So we take the friendly default and pay for it in noise. The
 * downgrade prints a banner, rides `GET /api/config`, and is named in the
 * footer of both settings modals — permanently, where the secret is
 * typed, rather than once at startup where the person typing it 20
 * minutes later will never see it.
 *
 * ## Why memory can be the better answer
 *
 * A file in a container's writable layer looks like persistence and isn't:
 * `docker run --rm` discards it, and so does any image update. An
 * in-memory store makes no such promise, and says so. Mounting a volume —
 * which the README already recommends for the catalog — flips the same
 * run to `file` with no configuration, because the mount is the user
 * stating that this directory is meant to survive.
 */

import { randomUUID } from "node:crypto";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  type SecretStorageInfo,
  type SecretStoreKind,
  secretStorageCaveat,
  secretStorageSummary,
} from "../secret-storage-info.js";
import {
  FileSecretStore,
  readSecretFilePermissions,
  tightenSecretFilePermissions,
} from "./file-secret-store.js";
import {
  isFileLockHeld,
  openSecretFileLock,
  withSecretFileLock,
} from "./file-lock.js";
import {
  KeyringSecretStore,
  parseAccount,
  probeKeyringAvailable,
  secretStoreGetMany,
  secretStoreSetMany,
  type SecretBulkRequest,
  secretStoreGetStrict,
  secretStoreIsDurable,
  SessionSecretStore,
  type SecretStore,
} from "./secret-store.js";

/** Env var naming an explicit store, bypassing the probe entirely. */
export const SECRET_STORE_ENV = "MCP_INSPECTOR_SECRET_STORE";

/** Env var overriding the secrets file location outright. */
export const SECRET_FILE_ENV = "MCP_INSPECTOR_SECRET_FILE";

/**
 * Env var relocating the Inspector's durable state directory. Already
 * honored by the web backend for OAuth tokens and `client.json`; the
 * secrets file follows it for the same reason, and because the mount check
 * below asks whether *that* directory survives. A container mounting only
 * the configured storage directory would otherwise be judged unmounted,
 * fall back to `memory`, and lose secrets the user had arranged to keep.
 */
export const STORAGE_DIR_ENV = "MCP_STORAGE_DIR";

const KINDS: SecretStoreKind[] = ["keyring", "file", "memory"];

export interface ResolvedSecretStore {
  store: SecretStore;
  info: SecretStorageInfo;
}

/**
 * Parse {@link SECRET_STORE_ENV}. An unrecognized value returns undefined
 * (falling through to the automatic policy) after a warning rather than
 * throwing: a typo in a compose file should not stop the Inspector from
 * starting, and the user needs the correct spellings more than a stack.
 */
export function parseSecretStoreEnv(
  raw: string | undefined,
): SecretStoreKind | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if ((KINDS as string[]).includes(value)) return value as SecretStoreKind;
  console.warn(
    `[mcp-inspector] Ignoring ${SECRET_STORE_ENV}="${raw}": expected one of ${KINDS.join(", ")}.`,
  );
  return undefined;
}

/**
 * Default secrets file: `MCP_INSPECTOR_SECRET_FILE` if named outright,
 * otherwise `secrets.json` in the configured storage directory, otherwise
 * beside the catalog in `~/.mcp-inspector`.
 */
export function defaultSecretFilePath(): string {
  const override = process.env[SECRET_FILE_ENV]?.trim();
  if (override) return path.resolve(override);
  const storageDir = process.env[STORAGE_DIR_ENV]?.trim();
  if (storageDir) return path.resolve(storageDir, "secrets.json");
  const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
  // Resolved like the two override branches. A service started with a minimal
  // environment has neither variable, and the `"."` fallback then yields
  // `.mcp-inspector/secrets.json` — a *relative* path, while
  // `FileSecretStoreOptions.filePath` and the `SecretStorageInfo.path` the UI
  // copies both promise an absolute one. The footer would offer to copy a
  // location that means nothing without knowing the process's cwd.
  return path.resolve(homeDir, ".mcp-inspector", "secrets.json");
}

/**
 * Are we in a container?
 *
 * Three signals, any of which is sufficient, because no single one covers
 * the runtimes people actually use: `/.dockerenv` is Docker-specific and
 * absent under Podman and containerd; the `/proc/1/cgroup` scan catches
 * those but reads like the host's under cgroup v2 on some setups; and
 * `KUBERNETES_SERVICE_HOST` catches a pod regardless of runtime.
 *
 * A false positive here is cheap and a false negative is cheaper still —
 * this only *biases the fallback* between two working stores, and the
 * mount check below is what actually decides. Nothing about correctness
 * rests on getting this exactly right, which is why it is allowed to be a
 * heuristic at all.
 */
export function isContainer(): boolean {
  if (process.env.KUBERNETES_SERVICE_HOST) return true;
  try {
    // `/.dockerenv` is Docker's marker; `/run/.containerenv` is Podman's
    // equivalent and is the only one a rootless Podman container reliably
    // has. Missing it classified such a container as a host, which is the
    // wrong way round to be wrong: the fallback then writes a file into the
    // ephemeral writable layer and calls it durable.
    if (
      fsSync.existsSync("/.dockerenv") ||
      fsSync.existsSync("/run/.containerenv")
    ) {
      return true;
    }
  } catch {
    // A sandboxed / restricted filesystem. Fall through to the cgroup read.
  }
  try {
    const cgroup = fsSync.readFileSync("/proc/1/cgroup", "utf-8");
    // `libpod` is what Podman actually writes into cgroup paths
    // (`/machine.slice/libpod-<id>.scope`); the literal string "podman"
    // often does not appear at all.
    return /\b(docker|containerd|kubepods|podman|libpod|lxc)\b/.test(cgroup);
  } catch {
    // Not Linux, or /proc is not mounted. Not a container as far as we know.
    return false;
  }
}

/**
 * Nearest ancestor of `dir` that actually exists.
 *
 * The directory usually does not exist on a first run — `~/.mcp-inspector`
 * is created on demand — so every check below has to ask about the closest
 * thing that does. A volume mounted *at* the target path exists by
 * definition, so the common positive case needs no walk at all.
 */
function nearestExisting(dir: string): string | null {
  let current = path.resolve(dir);
  while (!fsSync.existsSync(current)) {
    const parent = path.dirname(current);
    /* v8 ignore next -- @preserve: the walk can only run out of ancestors if
       the filesystem root itself does not exist, which would mean the process
       has no cwd to have resolved against. Kept as the loop's termination
       guard rather than trusting that invariant. */
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

/**
 * Mount points visible to this process, from `/proc/self/mountinfo`, or
 * `null` where that file cannot be read (macOS, Windows, a `/proc`-less
 * container).
 *
 * Field 5 of each line is the mount point, octal-escaped. `/` is dropped:
 * in a container that is the writable layer, which is exactly what the
 * durability question is asking *against*.
 */
/**
 * Undo the kernel's octal escaping of a mountinfo path.
 *
 * The field is space-delimited, so `show_mountinfo` escapes anything that
 * would break parsing — space (`\040`), tab (`\011`), newline (`\012`) and
 * the backslash itself (`\134`). Decoding only the space left a mounted
 * path containing any of the others compared in its escaped form, so it
 * matched nothing, and a genuinely mounted volume read as the container's
 * writable layer: `memory` selected, persistence silently lost on a box
 * that had arranged for it.
 *
 * Handled as one general `\ooo` pass rather than four literals, since the
 * escaping rule is octal-in-general and a future addition would otherwise
 * reintroduce exactly this bug.
 */
function unescapeMountPoint(point: string): string {
  return point.replace(/\\(\d{3})/g, (_match, octal: string) =>
    String.fromCharCode(parseInt(octal, 8)),
  );
}

/**
 * Filesystem types that live in RAM and vanish with the container.
 *
 * `docker run --tmpfs /home/node/.mcp-inspector` produces a real entry in
 * mountinfo, so a mount-table lookup alone answers "durable" and selects the
 * file store — publishing `durable: true` for a file that disappears when the
 * container stops. That is the same false promise the in-memory fallback
 * exists to avoid, reached by believing the mount table over the filesystem
 * type.
 */
const EPHEMERAL_FSTYPES = new Set(["tmpfs", "ramfs"]);

/**
 * Durable mount points visible to this process, or `null` where mountinfo
 * cannot be read.
 *
 * Field 5 is the mount point; the filesystem type is the first field *after*
 * the optional-fields separator (` - `), which is why the line is split on
 * that rather than indexed positionally — the optional fields before it are
 * variable in number, so `fields[8]` is not reliable.
 */
function readMountPoints(): string[] | null {
  try {
    return fsSync
      .readFileSync("/proc/self/mountinfo", "utf-8")
      .split("\n")
      .flatMap((line) => {
        const point = line.split(" ")[4];
        if (!point) return [];
        const after = line.split(" - ")[1];
        const fstype = after?.trim().split(/\s+/)[0];
        if (fstype && EPHEMERAL_FSTYPES.has(fstype)) return [];
        return [unescapeMountPoint(point)];
      })
      .filter((point) => point !== "/");
  } catch {
    return null;
  }
}

/**
 * Does `dir` live on something mounted over the root filesystem?
 *
 * Two mechanisms, because either one alone gets a realistic case wrong.
 *
 * **`/proc/self/mountinfo` first**, where it exists. It answers the question
 * actually being asked — "is this path *under* a mount" — rather than the
 * narrower "is this path *itself* a mount". The difference is a real
 * container layout: mounting a volume at `/home/node` leaves
 * `/home/node/.mcp-inspector` an ordinary subdirectory sharing its parent's
 * device, so a device-boundary test answers "not mounted" and demotes a
 * durable setup to session-only `memory`. Reading the mount table also sees
 * a bind mount that happens to come from the same device, which no `st_dev`
 * comparison can.
 *
 * **The `st_dev` comparison as the fallback**, and against `/` rather than
 * against the immediate parent — so a subdirectory of a mount is still
 * recognized. Outside a container this barely matters (the fallback there is
 * `file` either way); it matters in a `/proc`-less container, where being
 * wrong costs durability.
 *
 * Errors answer `false`, keeping the fallback conservative — `memory` in a
 * container — which never promises to keep a secret it then loses.
 */
export function isOnMountPoint(dir: string): boolean {
  try {
    const nearest = nearestExisting(dir);
    if (nearest === null) return false;
    // Resolve symlinks before comparing. `nearestExisting` walks lexically,
    // and the mountinfo comparison below is a string prefix — so a secrets
    // directory that is a *symlink into* a mounted volume
    // (`~/.mcp-inspector -> /data/inspector`, with `/data` mounted) never
    // matches any mount point, reads as the writable layer, and silently
    // selects the session-only store on a box that had arranged for
    // persistence. `statSync` in the fallback below already follows links;
    // this makes the primary path agree with it.
    //
    // Tolerant of its own failure: a path we cannot resolve (permissions, a
    // racing unmount) is better compared lexically than not compared at all,
    // since the lexical answer is what this did before and is correct
    // whenever no symlink is involved.
    let current = nearest;
    try {
      current = fsSync.realpathSync(nearest);
    } catch {
      // Keep the lexical path.
    }

    const mounts = readMountPoints();
    if (mounts !== null) {
      return mounts.some(
        (point) => current === point || current.startsWith(`${point}/`),
      );
    }

    const parent = path.dirname(current);
    if (parent === current) return false; // `dir` resolved to the root itself
    return fsSync.statSync(current).dev !== fsSync.statSync("/").dev;
  } catch {
    // Permission denied, a racing unmount, or a platform where `dev` is not
    // meaningful.
    return false;
  }
}

/** Build the store named by `kind`, plus the descriptor that explains it. */
async function buildStore(
  kind: SecretStoreKind,
  reason: SecretStorageInfo["reason"],
  detail?: string,
): Promise<ResolvedSecretStore> {
  if (kind === "keyring") {
    return {
      store: new KeyringSecretStore(),
      info: { kind, reason, durable: true },
    };
  }
  if (kind === "memory") {
    // `SessionSecretStore`, not the bare `InMemorySecretStore` the tests
    // use: it reports `isDurable() === false`, which is what stops the
    // mcp.json / client.json migrations from stripping a plaintext secret
    // off disk in exchange for a copy that dies with this process.
    return {
      store: new SessionSecretStore(),
      info: { kind, reason, durable: false, detail },
    };
  }
  const filePath = defaultSecretFilePath();
  const store = new FileSecretStore({ filePath });
  // Repair a loosened mode on a pre-existing file, and — unlike before —
  // *verify* the result. The UI and the README both state the file is 0600,
  // so a file we could not tighten (owned by another user, on a read-only
  // mount) has to be reported rather than quietly described as protected.
  // Repair only — the *reporting* belongs to the descriptor path, which
  // knows whether the file is encrypted and so what the consequence
  // actually is. This used to warn here too, in wording that claimed a
  // reader could read the secrets even when the file was ciphertext, and
  // duplicated the caveat `warnAboutSecretStorage` prints moments later.
  await tightenSecretFilePermissions(filePath);
  return {
    store,
    info: await describeFileStore(store, filePath, kind, reason, detail),
  };
}

/**
 * Build the descriptor for a file store by *looking at the file*.
 *
 * `store.encrypted` is what the next write will do; a file already on disk in
 * the clear stays readable until that write happens, and saying "File
 * (encrypted)" in the meantime is the one false reassurance this whole
 * subsystem exists not to give. With no file yet (or one we cannot parse) the
 * policy is all there is to report, and it is then accurate — the first write
 * creates the file in that mode.
 *
 * Split out from `buildStore` so it can be re-run: this is a property of a
 * file that changes underneath us, not a property of the selection.
 */
async function describeFileStore(
  store: FileSecretStore,
  filePath: string,
  kind: SecretStoreKind,
  reason: SecretStorageInfo["reason"],
  detail?: string,
): Promise<SecretStorageInfo> {
  const onDisk = await store.readOnDiskEncryption();
  // `absent` is the only state where falling back to the configured write
  // policy is honest — the first write will create the file in exactly that
  // mode. `unreadable` must not: the encryption state was never established,
  // and reporting the policy there would claim "Encrypted file" about a file
  // `set` is about to refuse.
  const unreadable = onDisk.state === "unreadable" ? onDisk.detail : undefined;
  const plaintext =
    onDisk.state === "absent" ? !store.encrypted : onDisk.state === "plaintext";
  // Re-checked here rather than captured at selection, for the same reason
  // the encryption state is: the mode can change under a running process,
  // and this descriptor is what the browser renders as fact. The *read-only*
  // half deliberately — describing must not chmod, least of all once per
  // page load on a file another process may be mid-write on. The repair
  // happens once, at selection.
  const perms = await readSecretFilePermissions(filePath);
  return {
    kind,
    reason,
    path: filePath,
    // Omitted entirely when the envelope could not be read, so no consumer
    // can read a default out of it.
    ...(unreadable === undefined ? { plaintext } : {}),
    ...(unreadable !== undefined ? { encryptionUnknown: unreadable } : {}),
    ...(perms.state === "loose" ? { looseMode: perms.mode } : {}),
    ...(perms.state === "unknown" ? { permissionsUnknown: perms.detail } : {}),
    // Only meaningful while the two disagree; omitted otherwise so the
    // payload does not carry a flag that says nothing.
    ...(unreadable === undefined && plaintext && store.encrypted
      ? { pendingEncryption: true }
      : {}),
    durable: true,
    detail,
  };
}

/**
 * Pick the fallback store for a host with no keychain. Exported for the
 * tests, which drive the container/mount predicates directly rather than
 * trying to make a real container appear.
 */
export function chooseFallbackKind(opts: {
  container: boolean;
  mounted: boolean;
}): SecretStoreKind {
  return opts.container && !opts.mounted ? "memory" : "file";
}

/**
 * Print the fallback / plaintext warnings.
 *
 * `console.warn` rather than the pino file logger deliberately: the person
 * who needs this is watching a terminal or `docker logs`, and store
 * selection happens before (and independently of) any logger being
 * configured.
 */
export function warnAboutSecretStorage(info: SecretStorageInfo): void {
  if (info.reason === "fallback") {
    console.warn(
      `\n[mcp-inspector] The OS keychain is not available, so secrets will be kept in: ${secretStorageSummary(info)}.` +
        (info.detail
          ? `\n[mcp-inspector] Keychain error: ${info.detail}`
          : "") +
        `\n[mcp-inspector] Set ${SECRET_STORE_ENV}=keyring|file|memory to choose explicitly.`,
    );
  }
  const caveat = secretStorageCaveat(info);
  if (caveat) console.warn(`[mcp-inspector] ${caveat}`);
}

let resolved: Promise<ResolvedSecretStore> | undefined;

/**
 * Resolve the active store, once per process.
 *
 * Cached because the probe is a native round-trip and, more importantly,
 * because the answer must not differ between two callers: the banner, the
 * `/api/config` payload, and the store actually doing the writing are
 * three consumers of one decision, and a re-probe that flipped would have
 * the UI describing a store nobody is using. There is no reset seam for
 * the same reason a platform does not grow a keychain mid-run; tests get a
 * fresh module (and so a fresh cache) via `vi.resetModules()`.
 */
export function resolveSecretStore(): Promise<ResolvedSecretStore> {
  resolved ??= (async (): Promise<ResolvedSecretStore> => {
    const configured = parseSecretStoreEnv(process.env[SECRET_STORE_ENV]);
    if (configured) {
      const result = await buildStore(configured, "configured");
      if (configured === "keyring") {
        await absorbFileSecretsIntoKeyring(result.store);
      }
      warnAboutSecretStorage(result.info);
      return result;
    }
    const probe = await probeKeyringAvailable();
    if (probe.available) {
      const result = await buildStore("keyring", "default");
      await absorbFileSecretsIntoKeyring(result.store);
      return result;
    }

    const kind = chooseFallbackKind({
      container: isContainer(),
      mounted: isOnMountPoint(path.dirname(defaultSecretFilePath())),
    });
    const result = await buildStore(kind, "fallback", probe.detail);
    warnAboutSecretStorage(result.info);
    return result;
  })();
  return resolved;
}

/**
 * Hand a leftover secrets file over to the keychain, once one exists.
 *
 * The transition this closes: a box with no libsecret falls back to
 * `secrets.json` and the user saves an OAuth client secret there. They
 * install libsecret. The next run probes successfully, selects the keychain
 * — and every value they saved becomes invisible, because nothing reads the
 * file any more. The data is still on disk, which makes it worse rather
 * than better: nothing looks broken, the secrets have simply gone, and the
 * file sits there as an unexplained leftover.
 *
 * The rules are the ones the two existing plaintext migrations already use,
 * for consistency rather than novelty:
 *
 * - **The keychain wins on conflict.** An account already present there is
 *   left alone; the file's value is treated as the older copy.
 * - **The file is removed only on complete success.** A partial hand-off
 *   leaves it exactly as it was, so the next run retries and the
 *   keychain-wins rule silently absorbs whatever already made it across.
 * - **An unreadable file is not an empty one.** If it cannot be decrypted
 *   (the passphrase changed, or is now unset) this reports and returns
 *   rather than deleting it — the whole point is not to lose the values.
 *
 * Never throws. A keychain that fails mid-hand-off leaves the file intact,
 * which is the safe state, and the user still gets a working session.
 */
export async function absorbFileSecretsIntoKeyring(
  keyring: SecretStore,
): Promise<void> {
  const filePath = defaultSecretFilePath();

  // Cheap, lock-free "is there anything at all to do". Taking the lock first
  // would mean every startup on the overwhelmingly common path — a keychain
  // is available and no file was ever written — creates and removes a lock
  // directory, and on a box whose storage dir does not exist yet the lock
  // cannot be created at all, so `withSecretFileLock` would warn about
  // unprotected writes on every single run with nothing to protect.
  //
  // Racy by construction, and that is fine: it can only be wrong by saying
  // "nothing here" about a file created a moment later, which is a file the
  // next run migrates — the same outcome as a writer that recreates the path
  // after the claim below. Everything that *acts* re-checks under the lock.
  if (!(await anythingToMigrate(filePath))) return;

  // Orphan adoption and the claim below run under the same cross-process lock
  // a `set` takes (#2082) — otherwise a concurrent writer's atomic rename can
  // land between the two and be adopted, claimed, or clobbered depending on
  // the interleaving.
  //
  // The hand-off itself deliberately runs **outside** it, under a lock on the
  // *snapshot* instead (see `handOffStagedSecrets`). Holding the main lock
  // across a keychain round-trip per secret blocks every ordinary writer for
  // the duration, and past the retry budget fails their save outright — which
  // is a worse regression than the race it would close, since #1950
  // guarantees a write completing after the claim survives.
  //
  const claimed = await withSecretFileLock(filePath, async () => {
    // A crash between the claim and the delete leaves only
    // `secrets.json.migrating-<pid>`. Checking the canonical path alone then
    // reports "nothing to migrate", the keychain is selected, and every stored
    // credential silently disappears — the claim protecting the delete having
    // introduced a way to lose everything. Adopt any orphan first.
    await recoverOrphanedSnapshots(filePath);

    if (!fsSync.existsSync(filePath)) return null;

    // **Claim the file atomically before reading it.** Comparing its contents
    // immediately before `rm` narrowed the window and could not close it: a
    // writer that completes a `set` after the comparison and before the delete
    // has its write verified, reports success, and then loses it — a *later*
    // successful write destroyed, which is worse than the optimistic-write
    // residual and, unlike that one, fixable here.
    //
    // `rename` is atomic and leaves the live path free. Everything after this
    // point operates on a snapshot nobody else can reach, and a writer that
    // recreates `secrets.json` in the meantime is simply untouched — its file
    // is a different one, and the next run migrates it.
    //
    // The staged name carries the pid so two Inspectors starting together
    // cannot claim the same destination; whichever wins the rename does the
    // migration and the loser sees ENOENT and returns.
    // A per-attempt nonce, not just the pid. `recoverOrphanedSnapshots`
    // deliberately leaves an orphan in place when a live `secrets.json` also
    // exists — and a pid-only name is reusable across restarts (pid 1 on every
    // container start), so the next claim would `rename` straight over that
    // orphan and permanently discard secrets it may uniquely hold.
    const staged = `${filePath}.migrating-${process.pid}-${randomUUID()}`;
    try {
      await fs.rename(filePath, staged);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        // Only ENOENT means someone else claimed it. Anything else — EACCES on
        // the directory, EROFS — leaves the file exactly where it is, and
        // returning quietly would select the keychain while file-backed
        // secrets sit there unreadable by anything, with nothing said.
        console.warn(
          `\n[mcp-inspector] Could not claim the secrets file at ${filePath} for migration into the OS keychain (${code ?? "unknown error"}), so it has been left in place. Its secrets are not visible to this session.`,
        );
      }
      return null;
    }
    // **Acquire the snapshot's lock before returning**, i.e. before the main
    // lock is released. Taking it afterwards leaves a gap in which a second
    // startup can take the main lock, see the staged file unlocked, and adopt
    // and re-claim it — leaving this process reading a path that no longer
    // exists, which is the very race the snapshot lock exists to prevent.
    //
    // `null` means locking is unavailable here; the hand-off still runs. The
    // exposure is one unique nonce-named snapshot, which is a far better
    // trade than refusing to migrate at all on a box that cannot lock.
    const releaseSnapshot = await openSecretFileLock(staged).catch(() => null);
    return { staged, releaseSnapshot };
    // `withSecretFileLock` rejects only with the `SecretStoreUnavailableError`
    // it constructs itself (a lock it could not create degrades instead of
    // throwing), so the cast is over a value produced one call away rather
    // than an assumption about arbitrary throwables.
  }).catch((err: Error) => {
    console.warn(
      `\n[mcp-inspector] Could not lock the secrets file at ${filePath} to migrate it into the OS keychain (${err.message}), so it has been left in place. Its secrets are not visible to this session; the next run will try again.`,
    );
    return null;
  });
  if (claimed === null) return;
  // Outside the main lock, still holding the snapshot's: a keychain
  // round-trip per secret must not block ordinary writers (#1950 guarantees a
  // write completing after the claim survives).
  try {
    await handOffStagedSecrets(claimed.staged, filePath, keyring);
  } finally {
    await claimed.releaseSnapshot?.();
  }
}

/**
 * Move a claimed snapshot's secrets into the keychain, then dispose of it.
 *
 * Runs under a lock on the **snapshot**, not on `secrets.json`. That is what
 * stops a second Inspector's {@link recoverOrphanedSnapshots} from adopting a
 * migration still in progress — it link/unlinks the snapshot back to the live
 * path and re-claims it, our hand-off then fails `ENOENT`, and if that second
 * process exits before copying, the healthy first session starts with none of
 * those secrets. Locking the snapshot says "in progress" in a way a filename
 * cannot, and expires by itself if this process dies.
 *
 * Holding the *main* lock here instead would also close it, and was tried:
 * it blocks every ordinary writer for the whole migration and fails their
 * save past the retry budget, breaking #1950's guarantee that a write
 * completing after the claim survives.
 */
async function handOffStagedSecrets(
  staged: string,
  filePath: string,
  keyring: SecretStore,
): Promise<void> {
  const file = new FileSecretStore({ filePath: staged });
  // True only when every value reached the keychain *and* there was
  // something to move — the one case where the snapshot is redundant.
  const absorbed = await handOff(file, staged, keyring);

  if (absorbed) {
    try {
      await fs.rm(staged, { force: true });
      console.warn(
        `\n[mcp-inspector] The OS keychain is available again. Secrets kept in ${filePath} while it was not have been moved into the keychain, and the file has been removed.`,
      );
    } catch (err) {
      // Every value is in the keychain, so this is not worth failing startup
      // over — but the snapshot is a *plaintext-capable copy of the secrets*
      // and the app is about to report the keychain as the only store. A
      // silent catch leaves a file the user cannot know to delete.
      console.warn(
        `\n[mcp-inspector] Secrets were moved into the OS keychain, but the temporary copy at ${staged} could not be removed (${err instanceof Error ? err.message : String(err)}). Delete it once you have confirmed the keychain has your secrets.`,
      );
    }
    return;
  }

  // Not fully migrated: put the snapshot back so the next run finds it.
  // Claiming the file is what makes the delete safe; it must not also make a
  // *failed* migration lose the file, which is what the claim exists to
  // prevent one line further down.
  try {
    // `link` and not `rename`: POSIX `rename` **replaces** its destination
    // silently, so restoring with it would overwrite a `secrets.json` that a
    // concurrent writer recreated while we held the snapshot — destroying a
    // later successful write, which is the exact loss the claim exists to
    // prevent. `link` fails with EEXIST instead, which is the no-clobber
    // primitive this needs; the snapshot is unlinked only once the live path
    // holds the same inode.
    await fs.link(staged, filePath);
    await fs.rm(staged, { force: true });
  } catch {
    // The live path is occupied, or hard links are unavailable here. Leave
    // the snapshot and say exactly where it is: an operator-visible orphan
    // is recoverable, and clobbering someone's write is not.
    console.warn(
      `\n[mcp-inspector] Could not restore ${staged} to ${filePath}; both files exist and the snapshot holds the secrets that were not migrated. Merge it by hand, or delete it once you have confirmed nothing is missing.`,
    );
  }
}

/**
 * Is `name` a migration snapshot, as opposed to the lock directory beside one?
 *
 * The `.lock` exclusion is load-bearing, not tidiness. `secrets.json.lock`
 * and `secrets.json.migrating-<pid>-<uuid>.lock` both match the plain prefix
 * test, and treating the latter as a snapshot is self-sustaining damage: the
 * liveness probe asks about a nonexistent `<name>.lock.lock` and so answers
 * "not held", recovery then tries to hard-link a *directory* onto the secrets
 * path, fails, and prints the orphan warning. Because a stale lock directory
 * is never removed by a liveness *check* — only a would-be acquirer clears
 * one — that false migration repeats on every startup forever, including
 * after the real snapshot has long since been recovered.
 */
const isSnapshotName = (name: string, base: string): boolean =>
  name.startsWith(`${base}.migrating-`) && !name.endsWith(".lock");

/**
 * Is there a `secrets.json`, or a snapshot orphaned by an interrupted
 * migration, worth taking the lock for?
 *
 * One `readdir` rather than a `stat` of the canonical path: an orphan is the
 * case where the live file is *absent* and there is still everything to
 * migrate, so checking only `secrets.json` would skip the recovery that
 * exists because skipping it loses every stored credential.
 */
async function anythingToMigrate(filePath: string): Promise<boolean> {
  const base = path.basename(filePath);
  try {
    return (await fs.readdir(path.dirname(filePath))).some(
      (name) => name === base || isSnapshotName(name, base),
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Only "there is no directory" proves there is nothing to migrate — the
    // first run on a fresh install, and the path this check exists to keep
    // quiet. Every other failure (EACCES, EPERM, EMFILE) means the directory
    // is there and could not be *listed*, which is not the same as empty: a
    // directory can deny listing while still permitting access to the known
    // `secrets.json` path, so returning false would select the keychain and
    // leave those secrets invisible with nothing said. Fall through instead
    // and let the under-lock `existsSync` and claim decide, which is what
    // happened before this fast path existed.
    return code !== "ENOENT" && code !== "ENOTDIR";
  }
}

/**
 * Adopt a snapshot left behind by a process that died mid-migration.
 *
 * Renamed back only when the canonical path is free — a live `secrets.json`
 * is newer than any orphan and must not be replaced. Otherwise the orphan is
 * reported rather than removed: it may hold values the live file does not,
 * and this is not the place to decide a merge.
 */
async function recoverOrphanedSnapshots(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => isSnapshotName(n, base));
  } catch {
    return; // No directory yet, or unreadable — nothing to recover.
  }
  for (const name of names) {
    const orphan = path.join(dir, name);
    // Not an orphan at all — another Inspector is migrating it right now, and
    // adopting it would link it back to the live path and re-claim it under a
    // new name while its owner is still reading it. That owner's hand-off
    // then fails `ENOENT`, and if we exit before copying, its healthy session
    // starts with none of those secrets. The lock expires on its own if that
    // process dies, so a genuinely abandoned snapshot becomes adoptable
    // without anything to clean up.
    if (await isFileLockHeld(orphan)) continue;
    try {
      await fs.link(orphan, filePath);
      await fs.rm(orphan, { force: true });
      console.warn(
        `\n[mcp-inspector] Recovered secrets left behind by an interrupted migration (${orphan} → ${filePath}).`,
      );
    } catch {
      console.warn(
        `\n[mcp-inspector] Found secrets from an interrupted migration at ${orphan}, and a current ${filePath} already exists, so it was left alone. It may hold values the current file does not.`,
      );
    }
  }
}

/**
 * The hand-off body: read the file, copy every entry into the keychain,
 * then delete the file.
 *
 * **It operates on a snapshot, not on the live file.** The caller claims
 * `secrets.json` with an atomic rename before this runs, so nothing else can
 * write to what is being read here and a writer that recreates the live path
 * is simply untouched. This replaced a re-read-and-compare before the
 * delete, which caught writes that had already landed and was blind to the
 * one arriving between the check and the `rm`.
 *
 * Returns whether the snapshot is fully absorbed — the caller deletes it
 * only then, and otherwise restores it to the live path. "Nothing to
 * migrate" reports `false`: no values moved, and the file's presence is what
 * records which encryption mode this install settled on.
 */
async function handOff(
  file: FileSecretStore,
  filePath: string,
  keyring: SecretStore,
): Promise<boolean> {
  let entries: Record<string, string> | null;
  try {
    entries = await file.readAll();
  } catch (err) {
    console.warn(
      `\n[mcp-inspector] The OS keychain is available again, but the secrets file at ${filePath} could not be read, so its contents were left there: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
  // Nothing to migrate. Report "do not delete" rather than "done": we moved
  // no values out of this file, and its presence is what records which
  // encryption mode this install settled on, so removing it would change
  // that on the user's behalf for no gain.
  if (!entries || Object.keys(entries).length === 0) return false;

  // A key that is not `serverId:field` cannot be addressed through the store
  // API, so it cannot be copied — which makes the hand-off incomplete by
  // definition, and an incomplete hand-off must not delete its source. It
  // used to be skipped and the file removed anyway, discarding the value
  // permanently to tidy up a file we had failed to fully migrate.
  let complete = true;
  try {
    for (const [account, value] of Object.entries(entries)) {
      const parsed = parseAccount(account);
      if (!parsed) {
        complete = false;
        continue;
      }
      // Strict: `get` answers `null` for an unreadable keychain as well as
      // for a missing entry, and this branch *writes* on `null`. A transient
      // read failure would therefore overwrite a newer keychain value with
      // the older file copy — the exact inversion of the keychain-wins rule
      // this migration is built on. A throw here aborts the hand-off and
      // leaves the file in place, so the next run retries.
      const existing = await secretStoreGetStrict(
        keyring,
        parsed.serverId,
        parsed.field,
      );
      if (existing === null) {
        await keyring.set(parsed.serverId, parsed.field, value);
      }
    }
  } catch (err) {
    console.warn(
      `\n[mcp-inspector] Could not move the secrets file at ${filePath} into the OS keychain, so it has been left in place: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  if (!complete) {
    console.warn(
      `\n[mcp-inspector] Secrets from ${filePath} have been copied into the OS keychain, but at least one entry could not be read (its key is not in \`serverId:field\` form). The file has been left in place so nothing is lost.`,
    );
    return false;
  }
  return true;
}

/**
 * The active store's descriptor — for the banner and `GET /api/config`.
 *
 * The *selection* is cached, deliberately (see {@link resolveSecretStore}).
 * The descriptor is not, for the file store: `plaintext` and
 * `pendingEncryption` describe bytes on disk that this very process
 * changes. Cache them and the first `set` under a newly-set passphrase
 * encrypts the file while every subsequent `/api/config` keeps serving
 * "still unencrypted" until a restart — stale in the safe direction, but
 * stale about the one fact this surface exists to state. Re-deriving costs
 * one read of a small file per config fetch, which is once per page load.
 */
export async function getSecretStorageInfo(): Promise<SecretStorageInfo> {
  const { store, info } = await resolveSecretStore();
  if (info.kind !== "file" || !(store instanceof FileSecretStore)) return info;
  return describeFileStore(
    store,
    store.filePath,
    "file",
    info.reason,
    info.detail,
  );
}

/**
 * A `SecretStore` that resolves the real one on first use.
 *
 * Selection is async (it probes the keychain) but every existing default
 * is a synchronous `new KeyringSecretStore()` in the middle of an options
 * object — `core/mcp/node/servers.ts`, `core/client/runner.ts`,
 * `core/mcp/remote/node/server.ts`. Making those async would ripple
 * through their callers to no benefit, since each method is already async
 * and can simply await the selection it needs. So the indirection lives
 * here, in one place, instead of in three signatures.
 */
class DeferredSecretStore implements SecretStore {
  private async target(): Promise<SecretStore> {
    return (await resolveSecretStore()).store;
  }
  async isDurable(): Promise<boolean> {
    return secretStoreIsDurable(await this.target());
  }
  /**
   * Forwarded, and its absence was a real defect rather than an omission:
   * this is the store production actually uses, so a `secretStoreGetStrict`
   * call against it fell through to the tolerant `get` and the strictness
   * existed only in tests that injected a concrete store.
   */
  async getStrict(serverId: string, field: string): Promise<string | null> {
    return secretStoreGetStrict(await this.target(), serverId, field);
  }
  async getMany(
    requests: SecretBulkRequest[],
  ): Promise<Record<string, Record<string, string>>> {
    return secretStoreGetMany(await this.target(), requests);
  }
  async get(serverId: string, field: string): Promise<string | null> {
    return (await this.target()).get(serverId, field);
  }
  async set(serverId: string, field: string, value: string): Promise<void> {
    await (await this.target()).set(serverId, field, value);
  }
  async setMany(
    serverId: string,
    values: Record<string, string>,
  ): Promise<void> {
    await secretStoreSetMany(await this.target(), serverId, values);
  }
  async delete(serverId: string, field: string): Promise<void> {
    await (await this.target()).delete(serverId, field);
  }
  async deleteAllForServer(serverId: string): Promise<void> {
    await (await this.target()).deleteAllForServer(serverId);
  }
}

/**
 * The default store for production call sites — what `new
 * KeyringSecretStore()` used to be. Every one of them now routes through
 * the same selection, so the CLI, the TUI, and the web backend cannot end
 * up writing to different places on the same box.
 */
export function defaultSecretStore(): SecretStore {
  return new DeferredSecretStore();
}
