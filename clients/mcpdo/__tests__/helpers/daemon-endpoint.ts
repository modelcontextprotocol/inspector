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
 * - {@link stopDaemonIn} — teardown for a daemon an mcpdo command spawned. The
 *   liveness signal is the published `mcpdod.token` and the `mcpdod.lock`,
 *   which exist on every platform (unlike a socket file) and which the daemon
 *   removes last on shutdown, after the socket.
 * - {@link removeDaemonDir} — `rmSync` with retries: a stopping daemon process
 *   still holds its `mcpdod.log` until it exits, which Windows reports as
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

/**
 * Stop the daemon serving `dir`, if any, and wait for its shutdown to finish.
 * `daemon/stop` answers before shutdown completes, so the wait is what keeps
 * the caller from deleting a directory a live daemon still holds.
 */
export async function stopDaemonIn(
  dir: string,
  waitMs: number = 5000,
): Promise<void> {
  if (!daemonMayBeLive(dir)) return;
  try {
    await callDaemon(
      "daemon/stop",
      {},
      { socketPath: daemonEndpoint(dir), dir, timeoutMs: 2000 },
    );
  } catch {
    // already stopped, or a stale token left by a daemon that died
  }
  const deadline = Date.now() + waitMs;
  while (daemonMayBeLive(dir) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Delete a daemon directory, retrying while an exiting daemon releases it. */
export function removeDaemonDir(dir: string): void {
  fs.rmSync(dir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
