import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Env: directory that owns daemon.sock + daemon.lock. */
export const DAEMON_DIR_ENV = "MCP_INSPECTOR_DAEMON_DIR";

/**
 * Env: IPC bearer token. Every daemon requires one: set it explicitly for
 * private mode, or leave it unset and the daemon generates one at startup
 * and publishes it to `daemon.token` (see {@link getDaemonTokenPath}).
 */
export const DAEMON_TOKEN_ENV = "MCP_INSPECTOR_DAEMON_TOKEN";

/**
 * Directory that owns the daemon socket + lock.
 * Precedence:
 * 1. `MCP_INSPECTOR_DAEMON_DIR` — explicit (private mode / auto-spawn parent)
 * 2. `MCP_STORAGE_DIR` — CI / parallel isolation (same override as oauth.json)
 * 3. `~/.mcp-inspector`
 */
export function getDaemonDir(): string {
  const daemonDir = process.env[DAEMON_DIR_ENV]?.trim();
  if (daemonDir) return path.resolve(daemonDir);
  const storage = process.env.MCP_STORAGE_DIR?.trim();
  if (storage) return path.resolve(storage);
  /* v8 ignore next 2 -- USERPROFILE is the Windows fallback; CI/darwin use HOME. */
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(home, ".mcp-inspector");
}

/**
 * Create a new private daemon directory (mode `0700`). Does not start the
 * daemon.
 *
 * Lives under `$TMPDIR/mcp-conn-<uid>/<id>/`, not `~/.mcp-inspector`: `sun_path`
 * caps Unix socket paths at 104 bytes on macOS (108 on Linux), and the tmp
 * dir is short on every platform (macOS's per-user `/var/folders/...` is the
 * long case, and even that fits with the 8-char id). The parent
 * `mcp-conn-<uid>` dir is also created 0700 so the layout never depends on the
 * platform's default tmp permissions.
 */
export function createPrivateDaemonDir(): string {
  /* v8 ignore next 2 -- getuid is missing only on Windows */
  const uid = typeof process.getuid === "function" ? process.getuid() : "u";
  const root = path.join(os.tmpdir(), `mcp-conn-${uid}`);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const id = randomBytes(4).toString("hex");
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { mode: 0o700 });
  try {
    fs.chmodSync(root, 0o700);
    fs.chmodSync(dir, 0o700);
  } catch {
    // best-effort on platforms that ignore mode
  }
  return dir;
}

export function getDaemonSocketPath(dir: string = getDaemonDir()): string {
  return path.join(dir, "daemon.sock");
}

export function getDaemonLockPath(dir: string = getDaemonDir()): string {
  return path.join(dir, "daemon.lock");
}

/**
 * IPC token published by a running daemon (0600, inside the 0700 daemon
 * dir). Written on start, removed on shutdown. Lets clients that didn't
 * spawn the daemon (and so have no `MCP_INSPECTOR_DAEMON_TOKEN` in their
 * environment) authenticate: filesystem permissions on the file are the
 * trust boundary, which is exactly the same-user boundary the socket has —
 * but requests now always carry a token, so there is no unauthenticated
 * request path at all.
 */
export function getDaemonTokenPath(dir: string = getDaemonDir()): string {
  return path.join(dir, "daemon.token");
}

/** Daemon stderr log (0600) — the only visibility into a detached daemon
 * that died during startup. */
export function getDaemonLogPath(dir: string = getDaemonDir()): string {
  return path.join(dir, "daemon.log");
}

/**
 * `sun_path` limit for Unix sockets: 104 bytes on macOS/BSD, 108 on Linux
 * (both including the trailing NUL). `listen()` fails opaquely above it —
 * historically the daemon then died silently and the client reported only a
 * generic start timeout. Validate up front with an actionable error instead.
 */
export function assertSocketPathWithinLimit(socketPath: string): void {
  /* v8 ignore next -- one arm per platform; CI runs each on its own OS */
  const limit = process.platform === "linux" ? 107 : 103;
  const bytes = Buffer.byteLength(socketPath);
  if (bytes > limit) {
    throw new Error(
      `Connection daemon socket path is too long for this platform ` +
        `(${bytes} bytes > ${limit}): ${socketPath}. ` +
        `Point MCP_INSPECTOR_DAEMON_DIR (or MCP_STORAGE_DIR) at a shorter directory.`,
    );
  }
}

/** Ensure the daemon directory exists before binding the socket.
 * Created 0700: the socket lives inside, so its own mode never has to be
 * the enforcement boundary (BSDs are inconsistent about socket modes). */
export function ensureDaemonDir(dir: string = getDaemonDir()): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}
