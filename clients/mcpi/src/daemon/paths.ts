import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Env: directory that owns daemon.sock + daemon.lock. */
export const DAEMON_DIR_ENV = "MCP_INSPECTOR_DAEMON_DIR";

/**
 * Env: IPC bearer token for private daemons. When set in the daemon process,
 * every request must present the same value. When unset, the daemon is shared
 * (same-UID filesystem trust only).
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

/** `~/.mcp-inspector` (or HOME-equivalent), ignoring daemon-dir overrides. */
export function getInspectorHome(): string {
  /* v8 ignore next 2 -- USERPROFILE is the Windows fallback; CI/darwin use HOME. */
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(home, ".mcp-inspector");
}

/**
 * Create a new private daemon directory under `~/.mcp-inspector/private/<id>/`
 * (mode `0700`). Does not start the daemon.
 */
export function createPrivateDaemonDir(): string {
  const id = randomUUID();
  const dir = path.join(getInspectorHome(), "private", id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
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

/** Ensure the daemon directory exists before binding the socket. */
export function ensureDaemonDir(dir: string = getDaemonDir()): void {
  fs.mkdirSync(dir, { recursive: true });
}
