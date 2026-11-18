/**
 * The daemon endpoint as the test harness sees it, on every platform (#2922).
 *
 * Production derives the endpoint from the daemon directory: a Unix socket
 * file `<dir>/mcpdod.sock` on POSIX, a named pipe `\\.\pipe\mcp-conn-<hash>`
 * on win32 (`getDaemonSocketPath`). A suite that hard-codes the `.sock` path
 * binds nothing on Windows (`EACCES`), and one that waits for that file to
 * vanish never sees a pipe at all. These helpers keep the suites on the
 * production derivation instead:
 *
 * - {@link daemonEndpoint} — where a daemon (or a fake) for `dir` listens.
 * - {@link releaseEndpoint} — what a test does after closing a fake's server:
 *   remove the socket file on POSIX; a pipe disappears with its server.
 * - {@link stopDaemonIn} — teardown for a daemon an mcpdo command spawned:
 *   stop it, then wait for its published `mcpdod.token` and `mcpdod.lock`
 *   (present on every platform, unlike a socket file) to go AND for its
 *   process to exit.
 * - {@link removeDaemonDir} — `rmSync`, retried while an exiting daemon still
 *   holds the directory (its cwd, its `mcpdod.log`), which Windows reports as
 *   `EBUSY`/`EPERM` rather than letting the directory go.
 *
 * A pipe has no directory, so a client given only a pipe cannot find the
 * token; every `callDaemon` here passes `dir` alongside `socketPath` (see
 * `daemonTokenDir`).
 */
import * as fs from "node:fs";
import { callDaemon } from "../../src/daemon/client.js";
import {
  getDaemonLockPath,
  getDaemonSocketPath,
  getDaemonTokenPath,
} from "../../src/daemon/paths.js";

/** The IPC endpoint a daemon (or a fake) for `dir` listens on. */
export function daemonEndpoint(dir: string): string {
  return getDaemonSocketPath(dir);
}

/** Remove a closed fake's socket file (POSIX); a named pipe needs nothing. */
export function releaseEndpoint(endpoint: string): void {
  if (process.platform !== "win32") fs.rmSync(endpoint, { force: true });
}

/** Whether a daemon for `dir` may still be running. */
export function daemonMayBeLive(dir: string): boolean {
  return (
    fs.existsSync(getDaemonTokenPath(dir)) ||
    fs.existsSync(getDaemonLockPath(dir))
  );
}

/** Whether process `pid` is still running. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but belongs to someone else — still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Stop the daemon serving `dir`, if any, and wait for its process to exit.
 *
 * `daemon/stop` answers before shutdown completes, and the daemon removes its
 * token and lock before its process actually exits (it exits once its event
 * loop drains). On POSIX that gap is harmless. On Windows it is not: the
 * daemon `chdir()`s into `dir` (see `daemon/run.ts`), and a directory that is
 * some process's cwd cannot be removed (`EBUSY`). So the wait is on the pid
 * the daemon reports in `ping`, not only on its files.
 *
 * The default budget keeps ping + stop + this wait + {@link removeDaemonDir}'s
 * retries inside the shared 30s `hookTimeout` (vitest.shared.mts).
 */
export async function stopDaemonIn(
  dir: string,
  waitMs: number = 8_000,
): Promise<void> {
  if (!daemonMayBeLive(dir)) return;
  const options = { socketPath: daemonEndpoint(dir), dir, timeoutMs: 2000 };
  let pid: number | undefined;
  try {
    ({ pid } = await callDaemon<{ pid?: number }>("ping", {}, options));
  } catch {
    // Nothing answers (a daemon answers `ping` even while stopping): the
    // token is stale — a closed fake's, or a dead daemon's — and there is no
    // shutdown to wait for. A process still draining is removeDaemonDir's.
    return;
  }
  try {
    await callDaemon("daemon/stop", {}, options);
  } catch {
    // already stopped
  }
  const deadline = Date.now() + waitMs;
  const running = () =>
    daemonMayBeLive(dir) ||
    (pid !== undefined && pid !== process.pid && processAlive(pid));
  while (running() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Errors Windows reports while some process still holds the directory. */
const HELD = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);

/**
 * Delete a daemon directory, retrying while an exiting daemon releases it.
 *
 * A daemon that stopped on its own — idle self-reap after a `disconnect`, or
 * a test's own `daemon stop` — has already removed its token and lock, so
 * {@link stopDaemonIn} has no pid to wait on, yet its process can still be
 * draining its event loop with `dir` as its cwd (Windows: `EBUSY`). Retry
 * until it lets go; the budget fits the shared 30s `hookTimeout` together
 * with {@link stopDaemonIn}'s.
 */
export async function removeDaemonDir(
  dir: string,
  waitMs: number = 15_000,
): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !HELD.has(code) || Date.now() - started >= waitMs) {
        throw new Error(
          `could not remove ${dir} after ${Date.now() - started}ms: ${String(error)}`,
          { cause: error },
        );
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}
