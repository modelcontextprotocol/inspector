import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CliExitCodeError, EXIT_CODES } from "@inspector/cli/error-handler.js";
import {
  generateDaemonToken,
  getDaemonTokenFromEnv,
  readDaemonTokenFile,
} from "./auth.js";
import { callDaemon } from "./client.js";
import {
  DAEMON_DIR_ENV,
  DAEMON_TOKEN_ENV,
  assertSocketPathWithinLimit,
  ensureDaemonDir,
  getDaemonDir,
  getDaemonLogPath,
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
    `Connection daemon bundle not found (looked for daemon.js near ${here}). Run npm run build in clients/daemon-cli.`,
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
  token: string,
  logPath: string,
  opts?: {
    timeoutMs?: number;
    /**
     * Set only when `token` was self-generated (shared mode). Two concurrent
     * first invocations each generate a token and spawn; the pid lock lets
     * one daemon survive, and it may not be ours. Re-reading the winner's
     * published `daemon.token` between polls lets the losing caller finish
     * against the surviving daemon instead of timing out on auth failures.
     * Explicitly supplied / private-mode tokens never fall back — a mismatch
     * there must stay a loud failure.
     */
    rereadTokenDir?: string;
  },
): Promise<void> {
  const deadline = Date.now() + (opts?.timeoutMs ?? READY_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (await isDaemonReachable(socketPath)) {
      const effectiveToken = opts?.rereadTokenDir
        ? (readDaemonTokenFile(opts.rereadTokenDir) ?? token)
        : token;
      try {
        await callDaemon(
          "ping",
          {},
          { socketPath, timeoutMs: 2000, token: effectiveToken },
        );
        return;
      } catch {
        // connected but not ready yet
      }
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  const logTail = readLogTail(logPath);
  throw new CliExitCodeError(
    EXIT_CODES.UNREACHABLE,
    `Timed out waiting for connection daemon at ${socketPath}` +
      (logTail ? `\nDaemon log (${logPath}):\n${logTail}` : ""),
    { code: "daemon_start_timeout" },
  );
}

/** Last few lines of the daemon's stderr log — the only trace of a spawn
 * that died before binding its socket. Best-effort. Exported for tests. */
export function readLogTail(logPath: string, maxLines = 10): string {
  try {
    const text = fs.readFileSync(logPath, "utf8");
    return text.trimEnd().split("\n").slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}

/**
 * Ensure a connection daemon is running for the current {@link getDaemonDir}.
 * Auto-spawns a detached Node process when the socket is not reachable.
 *
 * When `MCP_INSPECTOR_DAEMON_TOKEN` is set (private mode), the child inherits
 * that token; otherwise a fresh token is generated for the child. Either way
 * every IPC call must present it (clients that didn't spawn the daemon read
 * it from the published `daemon.token` file).
 */
export async function ensureDaemon(options?: {
  dir?: string;
  daemonScript?: string;
  token?: string;
  /** Startup wait override (tests exercise the timeout path). */
  readyTimeoutMs?: number;
}): Promise<{ socketPath: string; spawned: boolean }> {
  const dir = options?.dir ?? getDaemonDir();
  let token = options?.token ?? getDaemonTokenFromEnv();
  ensureDaemonDir(dir);
  const socketPath = getDaemonSocketPath(dir);
  // Fail here with an actionable error rather than letting the daemon's
  // listen() die over sun_path limits with only a generic start timeout.
  assertSocketPathWithinLimit(socketPath);

  if (await isDaemonReachable(socketPath)) {
    // Something accepted the connection, so a live daemon owns this socket.
    // Any ping failure here (daemon_auth_failed, timeout, protocol error)
    // must fail loudly: unlinking and respawning would let a caller with the
    // wrong token (or none) silently replace a live private daemon and
    // orphan its connections. Only a socket nothing is listening on — the
    // unreachable path below — is stale, and the spawned daemon itself
    // removes it after a connect probe (removeStaleDaemonSocket).
    token ??= readDaemonTokenFile(dir);
    await callDaemon("ping", {}, { socketPath, timeoutMs: 2000, token });
    return { socketPath, spawned: false };
  }

  // Every daemon requires a token; generate one for the child when the
  // caller/environment didn't supply one. The daemon republishes it to
  // daemon.token (0600) so unrelated clients can still connect.
  const tokenWasGenerated = token === undefined;
  token ??= generateDaemonToken();
  const script = options?.daemonScript ?? resolveDaemonScriptPath();
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    // Pin the socket directory explicitly so parent and child agree even when
    // MCP_STORAGE_DIR is unset (default ~/.mcp-inspector).
    [DAEMON_DIR_ENV]: dir,
    [DAEMON_TOKEN_ENV]: token,
  };

  // Detached + stdio "ignore" made every startup failure invisible. Capture
  // stderr in a 0600 log the start-timeout error can quote.
  const logPath = getDaemonLogPath(dir);
  let stderrTarget: number | "ignore" = "ignore";
  try {
    stderrTarget = fs.openSync(logPath, "a", 0o600);
    /* v8 ignore next 3 -- log capture is best-effort; openSync on a freshly
       ensured 0700 dir cannot be made to fail portably in tests. */
  } catch {
    // The daemon still runs without a log.
  }

  const child = spawn(process.execPath, [script], {
    detached: true,
    stdio: ["ignore", "ignore", stderrTarget],
    env: childEnv,
  });
  child.unref();
  /* v8 ignore next -- "ignore" only when the best-effort openSync failed */
  if (typeof stderrTarget === "number") {
    fs.closeSync(stderrTarget);
  }

  await waitForDaemon(socketPath, token, logPath, {
    timeoutMs: options?.readyTimeoutMs,
    rereadTokenDir: tokenWasGenerated ? dir : undefined,
  });
  return { socketPath, spawned: true };
}
