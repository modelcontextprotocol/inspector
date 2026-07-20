import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import { getDaemonTokenFromEnv } from "./auth.js";
import { callDaemon } from "./client.js";
import {
  DAEMON_DIR_ENV,
  DAEMON_TOKEN_ENV,
  ensureDaemonDir,
  getDaemonDir,
  getDaemonSocketPath,
} from "./paths.js";

const READY_TIMEOUT_MS = 10_000;
const READY_POLL_MS = 50;

/**
 * Resolve the built daemon entry (`build/daemon.js`) next to this package's
 * build output. When running from source under vitest, prefer the built file
 * if present; otherwise throw a clear error.
 */
export function resolveDaemonScriptPath(): string {
  // ensure.ts lives at src/daemon/ensure.ts → ../../build/daemon.js
  // In the bundle, import.meta.url is build/daemon-*.js or similar; tsup emits
  // ensure into the daemon entry chunk. Prefer an explicit sibling daemon.js.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "daemon.js"),
    path.resolve(here, "../daemon.js"),
    path.resolve(here, "../../build/daemon.js"),
    path.resolve(here, "../build/daemon.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  /* v8 ignore next 6 -- only when clients/cli/build is missing; pretest always
     builds, and fs.existsSync cannot be spied in this ESM package under vitest. */
  throw new CliExitCodeError(
    EXIT_CODES.USAGE,
    `Session daemon bundle not found (looked for daemon.js near ${here}). Run npm run build in clients/cli.`,
    { code: "daemon_not_built" },
  );
}

async function isDaemonReachable(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      /* v8 ignore next -- re-entry when connect and error both fire */
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.on("error", () => {});
      socket.destroy();
      resolve(ok);
    };
    socket.on("error", () => done(false));
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    /* v8 ignore next -- 500ms probe timeout; ensureDaemon usually connects faster */
    socket.once("timeout", () => done(false));
    socket.connect(socketPath);
  });
}

async function waitForDaemon(
  socketPath: string,
  token: string | undefined,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isDaemonReachable(socketPath)) {
      try {
        await callDaemon("ping", {}, { socketPath, timeoutMs: 2000, token });
        return;
      } catch {
        // connected but not ready yet
      }
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  /* v8 ignore next 5 -- requires a stuck spawn */
  throw new CliExitCodeError(
    EXIT_CODES.UNREACHABLE,
    `Timed out waiting for session daemon at ${socketPath}`,
    { code: "daemon_start_timeout" },
  );
}

/**
 * Ensure a session daemon is running for the current {@link getDaemonDir}.
 * Auto-spawns a detached Node process when the socket is not reachable.
 *
 * When `MCP_INSPECTOR_DAEMON_TOKEN` is set (private mode), the child inherits
 * that token and every IPC call must present it.
 */
export async function ensureDaemon(options?: {
  dir?: string;
  daemonScript?: string;
  token?: string;
}): Promise<{ socketPath: string; spawned: boolean }> {
  const dir = options?.dir ?? getDaemonDir();
  const token = options?.token ?? getDaemonTokenFromEnv();
  ensureDaemonDir(dir);
  const socketPath = getDaemonSocketPath(dir);

  if (await isDaemonReachable(socketPath)) {
    try {
      await callDaemon("ping", {}, { socketPath, timeoutMs: 2000, token });
      return { socketPath, spawned: false };
    } catch {
      // stale socket — fall through to spawn
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // ignore
      }
    }
  }

  const script = options?.daemonScript ?? resolveDaemonScriptPath();
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    // Pin the socket directory explicitly so parent and child agree even when
    // MCP_STORAGE_DIR is unset (default ~/.mcp-inspector).
    [DAEMON_DIR_ENV]: dir,
  };
  if (token !== undefined) {
    childEnv[DAEMON_TOKEN_ENV] = token;
  } else {
    delete childEnv[DAEMON_TOKEN_ENV];
  }

  const child = spawn(process.execPath, [script], {
    detached: true,
    stdio: "ignore",
    env: childEnv,
  });
  child.unref();

  await waitForDaemon(socketPath, token);
  return { socketPath, spawned: true };
}
