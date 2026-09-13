#!/usr/bin/env node
/**
 * Run a command under a machine-wide lease, so that concurrent `npm run
 * local:gate` runs in different worktrees queue instead of contending (#2339).
 *
 * **Two things go wrong when gates overlap, and both were measured** on
 * `v2/main` at `aa56551b` (M3, 8 logical cores). A quiet gate took 257s and
 * passed. Two started together in separate worktrees: one **failed** at 279s
 * — `smoke:web:chromium` found its fixed port (6298) held by the other gate's
 * copy of the same smoke — and the survivor took 338s, 1.3x, with the machine
 * half-free for its last minute. So the first problem is deterministic, not a
 * load effect: the web smokes bind fixed ports (6296–6299, plus the sandbox
 * and app-origin ports), so two gates reaching the same smoke together produce
 * a red run whose diff cannot have caused it — exactly the failure #2338
 * exists to stop. The second is load: with three or four sessions (#2323
 * measured sustained load averages of 50–70) every test budget is the wrong
 * number. Run back to back, the same two gates finish green in ~2x257s, and
 * each is measured against the quiet baseline every other #2338 aspect is
 * tuned to. So a second gate waits.
 *
 * **Why a lease and not a load threshold.** Two sessions each polling "is the
 * machine quiet yet?" deadlock on each other — neither ever clears, since each
 * is the reason the other is waiting (#2323). A lease *grants*: exactly one
 * waiter wins the `mkdir`, runs, and releases; the rest keep asking. There is
 * nothing to wait *for* except a release, and a release always comes — see the
 * crash case below.
 *
 * **Why `proper-lockfile`.** `core/auth/node/file-lock.ts` (#2082) records why
 * a hand-rolled election loses to it: `mkdir` is atomic, a live holder
 * refreshes the lock's mtime at `stale / 2` for as long as it lives, and a
 * holder that dies without releasing — a killed terminal, an OOM'd session —
 * stops refreshing, goes stale, and is taken over by the next waiter. That is
 * the whole "how does a crashed holder release" answer, and it is the
 * library's, not ours. The file-lock module's caveats about stale takeover
 * being non-single-winner apply here too and matter less: the worst case is
 * two gates running at once, which is exactly today's behaviour.
 *
 * **Why the lease is machine-wide.** The lock lives under `os.tmpdir()`
 * (`$XDG_RUNTIME_DIR` where a desktop session sets it), never inside a
 * worktree — a lock in the repo would be one per worktree, which is one per
 * session, which coordinates nothing.
 *
 * **Why default-on.** The sessions that need it are the ones that did not
 * think to opt in. `INSPECTOR_SKIP_GATE_LEASE=1` bypasses it, and the first
 * "waiting" line names the holder, its worktree, and that variable, so a wait
 * is never a mystery. It is also never a gate: a lock that cannot be *created*
 * (an unwritable tmpdir) runs the command unleased with a warning, because a
 * coordination aid must not acquire a new way to fail the gate it wraps.
 *
 * **Why the whole gate and not its parallel stages.** The serial stages are
 * not free — `lint` is type-aware and `build` is a full Vite bundle — and a
 * per-stage lease would let two gates interleave into the same 2.5x. One
 * lease around the whole run is the smallest thing that keeps the measured
 * baseline meaningful.
 *
 * Usage: `node scripts/gate-lease.mjs <command> [args...]`. The command runs
 * with inherited stdio in its own process group, so a signal to this process
 * stops the whole tree — `npm run` nests four deep and `sh` forwards nothing —
 * and the lease is released before this process exits with `128 + signal`.
 */

import { spawn } from "node:child_process";
import nodeFs, {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { constants as osConstants, tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
// CJS-only package; a default import is the shape every loader agrees on.
import properLockfile from "proper-lockfile";
import { winShellArgs } from "./lib/win-shell-args.mjs";

/** Set (to anything but `0` or empty) to run without taking the lease. */
export const SKIP_ENV = "INSPECTOR_SKIP_GATE_LEASE";

/** Overrides where the lease lives. Mostly a test seam; also a shared-box escape. */
export const DIR_ENV = "INSPECTOR_GATE_LEASE_DIR";

/**
 * How long a lease may go unrefreshed before a waiter may take it over.
 *
 * `proper-lockfile` refreshes the lock's mtime at `stale / 2`, so this is not
 * "how long a gate may run" — it is how long after a holder *dies* the queue
 * stays blocked. 30s rather than the library's 10s default, on purpose: the
 * refresh is a timer in an otherwise idle process, and the cost of a timer
 * firing late (a laptop waking from sleep, an event loop starved by the very
 * load this exists to manage) is a false takeover — two gates running at once,
 * the thing being prevented — whereas the cost of the longer window is 20
 * more seconds of waiting after a crash, against a gate that takes minutes.
 */
export const STALE_MS = 30_000;

/** How often a waiter re-asks. The acquire is one `mkdir`; this is not a hot loop. */
export const POLL_MS = 2_000;

/** How often a waiter says it is still waiting, so a long queue is visibly alive. */
export const PROGRESS_MS = 60_000;

/**
 * How long a waiter waits before giving up.
 *
 * A dead holder releases within {@link STALE_MS}, so this only ever expires
 * against a *live* holder that is still running after 45 minutes — four
 * queued quiet gates are ~18 minutes, so a holder that long is a hung gate, and
 * the right outcome is a loud failure naming it rather than a fifth process
 * joining the pile. An unbounded wait would be a task that looks like progress
 * and can never succeed.
 */
export const MAX_WAIT_MS = 45 * 60_000;

/** Where the lease lives. `$XDG_RUNTIME_DIR` is per-user and per-session where it exists. */
export function leaseDir(env = process.env) {
  if (env[DIR_ENV]) return path.resolve(env[DIR_ENV]);
  return path.join(env.XDG_RUNTIME_DIR || tmpdir(), "mcp-inspector-gate-lease");
}

/**
 * The lease target: `proper-lockfile` locks `<target>.lock` beside it and
 * never opens the target itself, so the target doubles as the holder record
 * (pid, worktree, start time) a waiter prints. It need not exist to be locked
 * (`realpath: false` below).
 */
export function leaseTarget(dir) {
  return path.join(dir, "local-gate");
}

/** The lock directory `proper-lockfile` creates for {@link leaseTarget}. */
export function lockPathOf(dir) {
  return `${leaseTarget(dir)}.lock`;
}

/** `INSPECTOR_SKIP_GATE_LEASE=0` and an empty value both mean "not skipped". */
export function isSkipped(env = process.env) {
  const value = env[SKIP_ENV];
  return value !== undefined && value !== "" && value !== "0";
}

/** `95s` → `1m35s`; sub-minute values stay in seconds. */
export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

/**
 * The exit code to report for a finished child: its own, or `128 + signal`
 * (the shell convention) when a signal ended it. `code` and `signal` are
 * mutually exclusive on a real ChildProcess exit.
 */
export function exitCodeFor({ code, signal }) {
  if (typeof code === "number") return code;
  return 128 + (osConstants.signals[signal] ?? 0);
}

/** The holder record the current holder wrote, or `null` if unreadable or malformed. */
export function readHolder(dir) {
  try {
    const record = JSON.parse(readFileSync(leaseTarget(dir), "utf8"));
    if (
      typeof record?.pid === "number" &&
      typeof record?.cwd === "string" &&
      typeof record?.startedAt === "number"
    ) {
      return record;
    }
  } catch {
    // Missing, unreadable, or not JSON — all mean "nothing to report".
  }
  return null;
}

/** One line a waiter can act on: who holds it, where, and for how long. */
export function describeHolder(holder, now = Date.now()) {
  if (holder === null) return "another local:gate";
  return `pid ${holder.pid} in ${holder.cwd}, running for ${formatDuration(now - holder.startedAt)}`;
}

/**
 * A lock directory's identity: what changes when it is removed and recreated.
 * `ino` and birth time rather than mtime, which the holder's own refresh
 * rewrites legitimately; `null` when it cannot be read.
 */
function identify(lockPath) {
  try {
    const stat = statSync(lockPath);
    return { ino: stat.ino, birthtimeMs: stat.birthtimeMs };
  } catch {
    return null;
  }
}

/**
 * A `proper-lockfile` `fs` shim whose directory removal refuses to delete a
 * lock that is no longer the one this process created.
 *
 * The library's stale takeover is not single-winner (see
 * `core/auth/node/file-lock.ts`, whose guard this mirrors): a holder whose
 * refresh timer was starved past {@link STALE_MS} can have its directory
 * replaced by a waiter, and its `release()` — and the library's `signal-exit`
 * handler — would then `rmdir` the *winner's* lock by path, letting a third
 * gate in beside the winner. Every removal the library performs goes through
 * this object, so guarding here covers both paths. Identity is captured in
 * the `mkdir` callback, the moment the directory becomes ours; `owned.id`
 * stays `null` until then so a stale directory the library removes on the
 * way to acquiring passes through untouched.
 */
function guardedFs(lockPath, owned, onRefused) {
  const mine = () => {
    if (owned.id === null) return true;
    const now = identify(lockPath);
    if (now === null) return false;
    return now.ino === owned.id.ino && now.birthtimeMs === owned.id.birthtimeMs;
  };
  const removeIfMine = () => {
    if (!mine()) {
      onRefused();
      return;
    }
    rmdirSync(lockPath);
  };
  return {
    fs: {
      ...nodeFs,
      mkdir: (p, cb) =>
        nodeFs.mkdir(p, (err) => {
          if (!err) owned.id = identify(lockPath);
          cb(err);
        }),
      // Reported as success when refused, so the library forgets the lock
      // either way rather than handing its exit handler a stale record.
      rmdir: (_p, cb) => {
        try {
          removeIfMine();
          cb(null);
        } catch (err) {
          cb(err);
        }
      },
      rmdirSync: () => removeIfMine(),
    },
    mine,
  };
}

/**
 * How to spawn `command args` on this platform. Shell-free everywhere but
 * Windows, where `npm` is `npm.cmd` and needs `cmd.exe` to start at all
 * (Node refuses shell-free `.cmd` spawns), so the arguments are quoted for
 * it. The process group that lets one signal reach the whole tree is a POSIX
 * notion, hence `detached` only there.
 */
export function spawnSpec(command, args, platform = process.platform) {
  const win32 = platform === "win32";
  return {
    command,
    args: winShellArgs(args, platform),
    shell: win32,
    detached: !win32,
  };
}

/**
 * Send `signal` to the child's whole process group (it was spawned as a group
 * leader), falling back to the child alone where groups are unavailable or the
 * group is already gone.
 */
function signalTree(child, signal) {
  try {
    if (process.platform !== "win32") {
      process.kill(-child.pid, signal);
      return;
    }
  } catch {
    // ESRCH: the group is already gone, or the child never became a leader.
  }
  try {
    child.kill(signal);
  } catch {
    // Already exited; nothing to signal.
  }
}

/**
 * Take the lease, waiting for a holder to release or go stale.
 *
 * Returns the release function, or `null` when a lock cannot be created here
 * at all — the caller then runs unleased. Throws only when the wait budget is
 * exhausted against a live holder.
 */
async function acquireLease({ dir, fs, log, pollMs, progressMs, maxWaitMs }) {
  const target = leaseTarget(dir);
  const startedWaiting = Date.now();
  let lastProgress = startedWaiting;
  let announced = false;
  for (;;) {
    try {
      return await properLockfile.lock(target, {
        realpath: false,
        stale: STALE_MS,
        retries: 0,
        fs,
        // The library's default throws from a timer with no caller on the
        // stack, which would take the *holder* down mid-gate. A compromised
        // lease means another gate is now running alongside this one — worth
        // saying, not worth killing a gate that is otherwise fine.
        onCompromised: (err) =>
          log(
            `gate-lease: another process took the lease over while this gate was running (${err.message}); continuing without it.`,
          ),
      });
    } catch (err) {
      // `ELOCKED` is not the only "someone holds it": a stale directory the
      // library could not remove (`ENOTEMPTY`, `EACCES`, `EROFS`) surfaces as
      // an ordinary error, and running unleased beside whatever holds it is
      // the overlap this exists to prevent. So the discriminator is the
      // directory: if it exists, wait; only a lock that could not be created
      // at all is a reason to degrade.
      if (err?.code !== "ELOCKED" && !existsSync(lockPathOf(dir))) {
        log(
          `gate-lease: could not take the lease at ${lockPathOf(dir)} (${err?.message ?? err}); running without it.`,
        );
        return null;
      }
    }
    const waited = Date.now() - startedWaiting;
    if (!announced) {
      announced = true;
      log(
        `gate-lease: ${describeHolder(readHolder(dir))} holds the gate lease; waiting for it to finish so the two do not contend. ${SKIP_ENV}=1 runs anyway.`,
      );
    } else if (Date.now() - lastProgress >= progressMs) {
      lastProgress = Date.now();
      log(
        `gate-lease: still waiting (${formatDuration(waited)}) on ${describeHolder(readHolder(dir))}.`,
      );
    }
    if (waited >= maxWaitMs) {
      throw new Error(
        `gate-lease: gave up after ${formatDuration(waited)} — ${describeHolder(readHolder(dir))} still holds ${lockPathOf(dir)}. If that gate is hung, stop it; ${SKIP_ENV}=1 runs without the lease.`,
      );
    }
    await delay(pollMs);
  }
}

/**
 * Run `command args` holding the lease, and resolve with the exit code to
 * report. Signals to this process stop the child's whole tree first and are
 * reported as `128 + signal` after the lease is released.
 *
 * Every knob is injectable so the tests can drive a real lock, a real child
 * and a real signal without waiting real minutes.
 *
 * @param {object} opts
 * @param {string} opts.command
 * @param {string[]} opts.args
 * @param {string} [opts.dir]          lease directory; default {@link leaseDir}
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(line: string) => void} [opts.log]
 * @param {number} [opts.pollMs]
 * @param {number} [opts.progressMs]
 * @param {number} [opts.maxWaitMs]
 * @param {number} [opts.graceMs]      SIGTERM → SIGKILL escalation on a signal
 * @param {import("node:child_process").StdioOptions} [opts.stdio]
 * @returns {Promise<number>}
 */
export async function runUnderLease({
  command,
  args,
  dir = leaseDir(),
  env = process.env,
  log = (line) => console.error(line),
  pollMs = POLL_MS,
  progressMs = PROGRESS_MS,
  maxWaitMs = MAX_WAIT_MS,
  graceMs = 5_000,
  stdio = "inherit",
}) {
  let release = null;
  let waited = 0;
  // Filled in by the shim the moment the lock directory is ours.
  const owned = { id: null };
  const guarded = guardedFs(lockPathOf(dir), owned, () =>
    log(
      "gate-lease: the lease was taken over by another gate while this one ran, so its lock was left alone rather than removed.",
    ),
  );
  if (isSkipped(env)) {
    log(`gate-lease: ${SKIP_ENV} is set; running without the lease.`);
  } else {
    let usable = true;
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      usable = false;
      log(
        `gate-lease: could not create ${dir} (${err?.message ?? err}); running without the lease.`,
      );
    }
    if (usable) {
      const startedWaiting = Date.now();
      release = await acquireLease({
        dir,
        fs: guarded.fs,
        log,
        pollMs,
        progressMs,
        maxWaitMs,
      });
      waited = Date.now() - startedWaiting;
    }
    if (release !== null) {
      if (waited >= pollMs) {
        log(`gate-lease: acquired after ${formatDuration(waited)}.`);
      }
      try {
        writeFileSync(
          leaseTarget(dir),
          JSON.stringify({
            pid: process.pid,
            cwd: process.cwd(),
            startedAt: Date.now(),
          }),
        );
      } catch {
        // Best effort: the record only improves a waiter's message.
      }
    }
  }

  const startedRunning = Date.now();
  // Release on every way out — a spawn failure included, or the lock would
  // sit held for STALE_MS with no gate running behind it.
  const finishLease = async () => {
    if (release === null) return;
    // The record is only meaningful while the lock beside it is held; a
    // waiter reading a fresh lock must not be told about the previous
    // holder — unless the lock is no longer ours, in which case the record
    // is the winner's too.
    try {
      if (guarded.mine()) rmSync(leaseTarget(dir), { force: true });
    } catch {
      // Diagnostic only; never let it stand between a finished gate and the
      // release below.
    }
    try {
      await release();
    } catch (err) {
      // `ERELEASED` means the library's own refresh tick already found the
      // lock taken over and dropped it; the directory there now is the
      // winner's live lock, and `onCompromised` has already said so.
      if (err?.code === "ERELEASED") return;
      log(
        `gate-lease: could not release the lease (${err?.message ?? err}). A waiter takes it over once it is ${formatDuration(STALE_MS)} stale — unless whatever blocked this removal persists, in which case remove ${lockPathOf(dir)} by hand.`,
      );
    }
    log(
      `gate-lease: released after ${formatDuration(Date.now() - startedRunning)}${waited >= pollMs ? ` (waited ${formatDuration(waited)} first)` : ""}.`,
    );
  };

  const spec = spawnSpec(command, args);
  const child = spawn(spec.command, spec.args, {
    stdio,
    env,
    shell: spec.shell,
    // Its own group, so one signal reaches every descendant. See the header.
    detached: spec.detached,
  });

  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  let stoppedBy = null;
  let escalation = null;
  const onSignal = (signal) => {
    if (stoppedBy !== null) return;
    stoppedBy = signal;
    log(`gate-lease: received ${signal}; stopping the gate.`);
    signalTree(child, signal);
    escalation = setTimeout(() => {
      log(
        `gate-lease: the gate did not exit within ${graceMs}ms of ${signal}; sending SIGKILL.`,
      );
      signalTree(child, "SIGKILL");
    }, graceMs);
  };
  const handlers = signals.map((signal) => {
    const handler = () => onSignal(signal);
    process.on(signal, handler);
    return [signal, handler];
  });

  let outcome;
  try {
    outcome = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
  } finally {
    clearTimeout(escalation);
    for (const [signal, handler] of handlers) process.off(signal, handler);
    await finishLease();
  }
  return stoppedBy !== null
    ? exitCodeFor({ code: null, signal: stoppedBy })
    : exitCodeFor(outcome);
}

/** `node scripts/gate-lease.mjs <command> [args...]` */
export async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (!command) {
    console.error("usage: node scripts/gate-lease.mjs <command> [args...]");
    return 2;
  }
  try {
    return await runUnderLease({ command, args });
  } catch (err) {
    console.error(err?.message ?? err);
    return 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main();
}
