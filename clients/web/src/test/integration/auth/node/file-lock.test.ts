/**
 * `withSecretFileLock` against a real filesystem and a real second process
 * (#2082).
 *
 * The property under test is cross-process mutual exclusion, and the
 * existing suite structurally cannot reach it: `FileSecretStore.serialize`
 * is one process-wide queue per path, so two in-process callers are ordered
 * before the lock ever sees them. A child process is not scaffolding here —
 * it is the only participant that can produce the interleaving.
 *
 * Four tests here raise their own budget past the integration project's 30s,
 * and are among the handful in the repo that still should (#2323). What they
 * wait on is not React or a renderer — it is `proper-lockfile`'s stale-lock
 * timeout and a second OS process actually contending for the file, which is
 * real elapsed work rather than slack. The named constants below say so at
 * each site; the restatements of the project's own 30s that used to sit
 * alongside them are gone.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import {
  withSecretFileLock,
  resetFileLockWarnings,
} from "@inspector/core/auth/node/file-lock.js";

/**
 * A test that waits for `proper-lockfile`'s retries to run out against a holder
 * that never yields — a live second process, or a stale lock it cannot clear.
 * Nothing is taken over here; the budget is spent in full by construction,
 * which is why it is the longer of the two.
 */
const LOCK_RETRIES_EXHAUSTED_MS = 90_000;
/**
 * A test that waits out the stale window and then *succeeds* by taking the dead
 * holder's lock over. Shorter, because it ends the moment the takeover lands
 * rather than when the retries stop.
 */
const STALE_LOCK_TAKEOVER_MS = 60_000;
import { FileSecretStore } from "@inspector/core/auth/node/file-secret-store.js";
import { SecretStoreUnavailableError } from "@inspector/core/auth/node/secret-store.js";

const run = promisify(execFile);
const require_ = createRequire(import.meta.url);
/**
 * Resolved in the parent and handed to the child. The child's cwd is not
 * this repo, and `proper-lockfile` lives in the *root* install rather than
 * `clients/web`'s, so a bare `require("proper-lockfile")` there resolves
 * against whatever happens to be above the temp directory — usually nothing.
 */
const LOCKFILE_MODULE = require_.resolve("proper-lockfile");

let tmpDir: string;
let warn: MockInstance<typeof console.warn>;
const filePath = (): string => path.join(tmpDir, "secrets.json");

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "inspector-lock-"));
  resetFileLockWarnings();
  // These paths warn by design; asserting on the text is the point, and
  // letting it reach the real console would bury the suite's output.
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  warn.mockRestore();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Everything `console.warn` was handed this test, as one string. */
const warnings = (): string =>
  warn.mock.calls.map((c) => String(c[0])).join("\n");

/**
 * Hold the lock on `target` in a **real second process** for `holdMs`, and
 * resolve once that child confirms it has it.
 *
 * Resolving on the child's confirmation rather than on a sleep is what makes
 * the ordering assertions below meaningful: the parent starts contending
 * only once the lock is provably held elsewhere, so a pass cannot come from
 * the parent simply getting there first.
 */
async function holdLockInChildProcess(
  target: string,
  holdMs: number,
  /**
   * Secrets the child writes *while holding the lock*, before it announces
   * itself. A parent that honours the lock therefore reads a map that already
   * contains them, which is what lets the caller assert on the merged result
   * rather than only on timing.
   */
  writeWhileHeld?: Record<string, string>,
): Promise<{ ready: Promise<void>; done: Promise<void> }> {
  const script = `
    const lockfile = require(${JSON.stringify(LOCKFILE_MODULE)});
    const fs = require("node:fs");
    const path = require("node:path");
    // A second Inspector reaches the lock through \`withSecretFileLock\`, which
    // creates the storage directory first. Mirror that, or the fresh-install
    // case below would be testing the child's omission rather than the parent.
    fs.mkdirSync(path.dirname(${JSON.stringify(target)}), { recursive: true });
    lockfile
      .lock(${JSON.stringify(target)}, { realpath: false, stale: 10000 })
      .then(async (release) => {
        const secrets = ${JSON.stringify(writeWhileHeld ?? null)};
        if (secrets) {
          fs.writeFileSync(
            ${JSON.stringify(target)},
            JSON.stringify({ version: 1, encryption: "none", secrets }),
          );
        }
        process.stdout.write("acquired\\n");
        await new Promise((r) => setTimeout(r, ${holdMs}));
        await release();
        process.stdout.write("released\\n");
      })
      .catch((err) => {
        process.stdout.write("failed:" + err.code + "\\n");
        process.exitCode = 1;
      });
  `;
  const child = run(process.execPath, ["-e", script]);
  let seenReady = false;
  const done = child.then(({ stdout }) => {
    expect(stdout).toContain("acquired");
    expect(stdout).toContain("released");
  });
  // `execFile` buffers, so the "acquired" line is only readable off the
  // stream. Subscribe before awaiting anything, or the line is missed.
  const ready = new Promise<void>((resolve, reject) => {
    child.child.stdout?.on("data", (chunk: Buffer) => {
      if (!seenReady && chunk.toString().includes("acquired")) {
        seenReady = true;
        resolve();
      }
    });
    child.catch(reject);
  });
  return { ready, done };
}

describe("withSecretFileLock across processes", () => {
  it("waits for a lock another process holds, then runs", async () => {
    const target = filePath();
    const { ready, done } = await holdLockInChildProcess(target, 400);
    await ready;

    const startedAt = Date.now();
    let ranAt = 0;
    await withSecretFileLock(target, async () => {
      ranAt = Date.now();
    });

    // It waited rather than barging in. The child holds for 400ms and the
    // retry schedule's first sleeps are tens of milliseconds, so anything
    // above a floor well under 400 proves contention without pinning the
    // assertion to the scheduler's exact wake-up.
    expect(ranAt - startedAt).toBeGreaterThan(200);
    // …and having waited, it did not report a degraded write.
    expect(warnings()).toBe("");
    await done;
  });

  it("locks a file that does not exist yet", async () => {
    // The first `set` on a fresh install has no `secrets.json` — and
    // `proper-lockfile` resolves its target through `fs.realpath` by
    // default, which is `ENOENT` there. `realpath: false` is what makes the
    // very first write lockable; without it the one call with nothing to
    // fall back on is the one that runs unprotected.
    const target = filePath();
    await expect(fs.stat(target)).rejects.toThrow();

    let ran = false;
    await withSecretFileLock(target, async () => {
      ran = true;
    });

    expect(ran).toBe(true);
    expect(warnings()).toBe("");
  });

  it("makes FileSecretStore.set wait on a lock another process holds", async () => {
    // The end-to-end shape from the issue: a CLI run beside a web session.
    //
    // Deliberately asserts that the parent's `set` has *not finished* while
    // the child holds the lock. A test that only checks both keys survive
    // afterwards passes with the lock removed from `mutate` entirely — the
    // optimistic verify would repair the clobber and hide the regression.
    // Not-yet-resolved is the observation only a real lock can produce.
    const target = filePath();
    const { ready, done } = await holdLockInChildProcess(target, 700, {
      "srv:env:FROM_CHILD": "1",
    });
    await ready;

    let settled = false;
    const store = new FileSecretStore({ filePath: target });
    const pending = store.set("srv", "env:FROM_PARENT", "2").then(() => {
      settled = true;
    });

    // Comfortably inside the child's hold, and comfortably outside the few
    // milliseconds an unlocked read-modify-write would take.
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false);

    await done;
    await pending;

    // Having waited, the parent read the map the child left, so its own entry
    // landed *on top of* the child's rather than replacing it.
    const reader = new FileSecretStore({ filePath: target });
    expect(await reader.get("srv", "env:FROM_CHILD")).toBe("1");
    expect(await reader.get("srv", "env:FROM_PARENT")).toBe("2");
    expect(warnings()).toBe("");
  });

  it("creates the storage directory so the very first save is locked too", async () => {
    // `writeStoreFile` creates the parent directory, but from *inside* the
    // locked section — so without the `mkdir` in `withSecretFileLock` the
    // first save on a fresh install fails `ENOENT` on the lock and degrades
    // to an unlocked write. That is the save most likely to be racing
    // another, since two Inspectors started together both reach it.
    const target = path.join(tmpDir, "fresh-install", "secrets.json");
    const { ready, done } = await holdLockInChildProcess(target, 700);
    await ready;

    let settled = false;
    const store = new FileSecretStore({ filePath: target });
    const pending = store.set("srv", "env:FIRST_EVER", "1").then(() => {
      settled = true;
    });

    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false);

    await done;
    await pending;

    const reader = new FileSecretStore({ filePath: target });
    expect(await reader.get("srv", "env:FIRST_EVER")).toBe("1");
    // No degrade warning: the lock was genuinely held, not skipped.
    expect(warnings()).toBe("");
  });
});

describe("withSecretFileLock degrades rather than failing", () => {
  it("runs the body anyway when the lock cannot be created, and says so once", async () => {
    // A path whose parent is a *file* stands in for every real variant —
    // read-only `$HOME`, a mount owned by another uid, a filesystem without
    // `mkdir` semantics — and unlike a permissions-based setup it fails the
    // same way for root, so it cannot pass locally and flake in a container.
    // Note a merely *missing* directory is no longer this case:
    // `withSecretFileLock` creates it. This store exists for boxes where the
    // usual mechanism is missing, so it must not gain a new way to be
    // unavailable.
    await fs.writeFile(path.join(tmpDir, "not-a-dir"), "", "utf-8");
    const target = path.join(tmpDir, "not-a-dir", "secrets.json");

    let ran = 0;
    await withSecretFileLock(target, async () => {
      ran += 1;
    });
    await withSecretFileLock(target, async () => {
      ran += 1;
    });

    expect(ran).toBe(2);
    expect(warnings()).toContain("Could not take a lock on the secrets file");
    // Once per reason per process — a warning on every save would be noise
    // on precisely the deployment that cannot act on it.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it(
    "refuses the save rather than writing alongside a live holder",
    async () => {
      // `ELOCKED` is evidence the lock is *working*, so degrading here would
      // enter the exact interleaving the lock exists to prevent — and enter it
      // knowing another writer is there. Held from this process, which is
      // indistinguishable to `proper-lockfile` from a remote holder (it is not
      // reentrant); the in-process queue is what keeps that out of the way in
      // production.
      //
      // The wait is real: the retry budget deliberately outlasts the 10s stale
      // window so a *crashed* holder resolves by takeover instead of failing
      // everyone else's saves. This holder is alive and refreshing, so it never
      // goes stale and the budget is spent in full.
      const target = filePath();
      const lockfile = require_(LOCKFILE_MODULE) as {
        lock: (f: string, o: object) => Promise<() => Promise<void>>;
      };
      // The **same** `stale` production uses, and that is not incidental:
      // `isLockStale` is evaluated against the *waiter's* threshold while the
      // holder refreshes on its own `stale / 2`. A holder configured looser
      // (say 60s) refreshes every 30s and is therefore declared stale by a
      // 10s waiter after 10s — the waiter takes over and the save succeeds,
      // quietly testing the opposite of what this test claims.
      const release = await lockfile.lock(target, {
        realpath: false,
        stale: 10_000,
      });

      const store = new FileSecretStore({ filePath: target });
      // One call, both assertions off the same rejection: each attempt spends
      // the full retry budget, so a second would double the test's runtime to
      // re-prove the same thing.
      const err = await store
        .set("srv", "env:MINE", "1")
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SecretStoreUnavailableError);
      expect((err as Error).message).toMatch(/was not saved/);
      await release();

      // Nothing was written behind the holder's back.
      expect(existsSync(target)).toBe(false);
    },
    LOCK_RETRIES_EXHAUSTED_MS,
  );

  it(
    "refuses rather than degrading when a stale lock cannot be cleared",
    async () => {
      // `acquireLock` does not only *create* directories — on finding a stale
      // one it removes it and retries, and that removal can fail. A stale lock
      // with anything inside it fails `ENOTEMPTY`, which is not `ELOCKED`, and
      // treating every non-`ELOCKED` error as "locks do not work here" meant
      // every Inspector on the box quietly bypassed the *same* stuck lock and
      // raced its writes — while the release-failure message was telling the
      // operator saves would keep failing until they cleared it.
      const target = filePath();
      const lockPath = `${target}.lock`;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.mkdir(lockPath);
      await fs.writeFile(`${lockPath}/stray`, "", "utf-8");
      // Backdated so it reads as stale — which is what sends `acquireLock` down
      // the remove-and-retry path rather than straight to `ELOCKED`.
      const longDead = new Date(Date.now() - 60_000);
      await fs.utimes(lockPath, longDead, longDead);

      const store = new FileSecretStore({ filePath: target });
      const err = await store
        .set("srv", "env:MINE", "1")
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(SecretStoreUnavailableError);
      expect((err as Error).message).toMatch(/was not saved/);
      // Nothing written behind the stuck lock, and no "unprotected" warning:
      // this is a refusal, not a degrade.
      expect(existsSync(target)).toBe(false);
      expect(warnings()).not.toContain("not protected");
    },
    LOCK_RETRIES_EXHAUSTED_MS,
  );

  it(
    "takes over the lock of a holder that died, rather than failing the save",
    async () => {
      // The invariant behind refusing on `ELOCKED`: refusing is only defensible
      // because a *crashed* holder resolves on its own first. `RETRY` therefore
      // has to outlast `STALE_MS` — if the budget were the shorter of the two,
      // one Inspector killed mid-save would make every later save on the box
      // fail until someone deleted the lock by hand.
      //
      // A dead holder is exactly a lock directory nobody is refreshing, so it
      // is staged directly: no child to race, and no dependence on how quickly
      // a killed process is reaped.
      const target = filePath();
      const lockPath = `${target}.lock`;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.mkdir(lockPath);
      const longDead = new Date(Date.now() - 60_000);
      await fs.utimes(lockPath, longDead, longDead);

      const store = new FileSecretStore({ filePath: target });
      await store.set("srv", "env:AFTER_CRASH", "1");

      const reader = new FileSecretStore({ filePath: target });
      expect(await reader.get("srv", "env:AFTER_CRASH")).toBe("1");
      // Took the lock over — did not fall through to an unlocked write.
      expect(warnings()).toBe("");
    },
    STALE_LOCK_TAKEOVER_MS,
  );

  it(
    "stays silent per the delete contract when the lock is held",
    async () => {
      // `delete` reports nothing by contract — only `set` hard-fails — so the
      // refusal above must not turn a delete into a throw.
      const target = filePath();
      const store = new FileSecretStore({ filePath: target });
      await store.set("srv", "env:A", "1");

      const lockfile = require_(LOCKFILE_MODULE) as {
        lock: (f: string, o: object) => Promise<() => Promise<void>>;
      };
      // The **same** `stale` production uses, and that is not incidental:
      // `isLockStale` is evaluated against the *waiter's* threshold while the
      // holder refreshes on its own `stale / 2`. A holder configured looser
      // (say 60s) refreshes every 30s and is therefore declared stale by a
      // 10s waiter after 10s — the waiter takes over and the save succeeds,
      // quietly testing the opposite of what this test claims.
      const release = await lockfile.lock(target, {
        realpath: false,
        stale: 10_000,
      });
      await expect(store.delete("srv", "env:A")).resolves.toBeUndefined();
      await release();

      // …and the entry it could not delete is still there, not half-removed.
      expect(await store.get("srv", "env:A")).toBe("1");
    },
    LOCK_RETRIES_EXHAUSTED_MS,
  );
});

describe("withSecretFileLock reports what it cannot clean up", () => {
  it("does not delete the winner's lock after being taken over", async () => {
    // The destructive half of the stale-takeover race. `proper-lockfile`'s
    // removal is an unconditional `rmdir`, so a holder whose lock was
    // replaced deletes the *winner's* directory on the way out — one
    // compromised holder becoming two unprotected writers. Its own detection
    // cannot prevent that: it runs on the refresh tick (5s here) while an
    // ordinary mutation finishes in well under a second.
    //
    // No waiting here, deliberately: this is the fast case the tick misses.
    const target = filePath();
    const lockPath = `${target}.lock`;

    let winner: { ino: number; birthtimeMs: number } | undefined;
    const result = await withSecretFileLock(target, async () => {
      await fs.rm(lockPath, { recursive: true, force: true });
      await fs.mkdir(lockPath);
      const stat = await fs.stat(lockPath);
      winner = { ino: stat.ino, birthtimeMs: stat.birthtimeMs };
      return "saved";
    });

    expect(result).toBe("saved");
    // Same directory, not a recreated one — it was left alone, not deleted.
    const after = await fs.stat(lockPath);
    expect(after.ino).toBe(winner?.ino);
    expect(after.birthtimeMs).toBe(winner?.birthtimeMs);
    expect(warnings()).toContain("was taken over by another process");
  });

  it("the exit handler this guards against really does delete a lock", async () => {
    // The other lifecycle window, and the reason the guard lives in
    // `options.fs` rather than in a check before `release()`:
    // `proper-lockfile` registers a `signal-exit` handler that `rmdirSync`s
    // every lock it still has registered, with no ownership check of its own.
    // A guard placed only around release would leave that free to delete the
    // winner's directory if the process exits at the wrong moment.
    //
    // Shown in a real child, because the handler only runs on a real exit,
    // and with an **empty** replacement directory — a non-empty one makes
    // `rmdirSync` fail `ENOTEMPTY` and would "pass" for the wrong reason,
    // which is exactly how the first draft of this test fooled itself.
    //
    // `withSecretFileLock` routes that same handler through the shim's
    // `rmdirSync`, which shares `removeIfMine` with the release path proven
    // by the test above.
    const target = filePath();
    const lockPath = `${target}.lock`;
    await fs.mkdir(path.dirname(target), { recursive: true });

    const script = `
      const lockfile = require(${JSON.stringify(LOCKFILE_MODULE)});
      const fs = require("node:fs");
      const lockPath = ${JSON.stringify(lockPath)};
      lockfile
        .lock(${JSON.stringify(target)}, { realpath: false, stale: 10000 })
        .then(() => {
          // Taken over while we hold it, then exit *without* releasing.
          fs.rmSync(lockPath, { recursive: true, force: true });
          fs.mkdirSync(lockPath);
          process.exit(0);
        });
    `;
    await run(process.execPath, ["-e", script]);

    // Unguarded, the winner's directory is gone.
    expect(existsSync(lockPath)).toBe(false);
  });

  it("tells the operator to clear a lock that cannot expire on its own", async () => {
    // `rmdir` refuses a non-empty directory — and so does stale takeover,
    // which reclaims through the same call. So an `ENOTEMPTY` lock is not
    // cleaned up by the staleness mechanism, by us, or by the next writer:
    // every later save fails `ELOCKED` against it until somebody deletes it.
    // Promising it "expires on its own after 10s" would be false.
    const target = filePath();
    const result = await withSecretFileLock(target, async () => {
      await fs.writeFile(`${target}.lock/stray`, "", "utf-8");
      return "saved";
    });

    // The body's result is returned regardless: a save that completed must
    // not be turned into a failure by its own teardown.
    expect(result).toBe("saved");
    expect(warnings()).toContain("Could not release the lock");
    // Conditional guidance, not an instruction. `proper-lockfile` forwards
    // whatever the filesystem returned and nothing here can tell a permanent
    // refusal from a transient one — and if it was transient, this path may
    // by then hold a *different, live* Inspector's lock, so an unconditional
    // "remove it" would destroy the exclusion of a process that did nothing
    // wrong. Both conditions must be stated.
    expect(warnings()).toContain("If saves keep failing");
    expect(warnings()).toContain("no other Inspector is running");
    // …and it must not promise the lock clears by itself either, which is
    // false whenever the same `rmdir` also blocks stale takeover.
    expect(warnings()).not.toMatch(/It expires on its own/);
  });

  it("warns rather than crashing the process when the library detects the takeover", async () => {
    // `proper-lockfile`'s default `onCompromised` *throws*, from a timer with
    // no caller on the stack — an uncaught exception that takes an Inspector
    // session down. Replaced with a warning. This is the slow path: the lock
    // is removed and the body stays alive past the refresh tick, so the
    // library's own detection fires rather than the removal guard.
    const target = filePath();
    await withSecretFileLock(target, async () => {
      await fs.rm(`${target}.lock`, { recursive: true, force: true });
      await vi.waitFor(
        () => expect(warnings()).toContain("was taken over by another process"),
        { timeout: 20_000, interval: 250 },
      );
    });

    // And it must NOT go on to tell the operator to delete the lock. Once the
    // tick has fired, `release()` answers `ERELEASED` without touching the
    // filesystem — the directory sitting at that path is then whoever took
    // over, so "remove it by hand" would destroy the exclusion of a process
    // that did nothing wrong. `onCompromised` has already said what happened.
    expect(warnings()).not.toContain("by hand");
    expect(warnings()).not.toContain("Could not release the lock");
  });
});
