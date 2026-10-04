import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { CallbackNavigation } from "@inspector/core/auth/index.js";
import type {
  InspectorServerSettings,
  MCPServerConfig,
} from "@inspector/core/mcp/types.js";
import { CliExitCodeError, EXIT_CODES } from "@inspector/cli/error-handler.js";
import { getDaemonDir } from "../daemon/paths.js";
import { authorizeInFrontend } from "./authorize.js";
import { sanitizeText } from "./sanitize.js";

/**
 * Detached OAuth completion helper for the non-TTY `connect` path.
 *
 * An agent driving mcpdo over pipes cannot sit on a blocking interactive
 * OAuth flow: the auth URL stays invisible in a buffered foreground pipe, and
 * killing the foreground process would tear down the loopback callback
 * listener the URL points at (staling the link). Instead, `connect` spawns
 * this helper detached: the helper owns the whole interactive flow
 * (callback listener, authorization-code exchange, token persistence to the
 * shared `oauth.json`), reports the freshly minted authorize URL back over
 * its stdout pipe, and keeps running after the parent exits — bounded by the
 * flow's own 15-minute callback wait. The parent relays the URL and exits;
 * the daemon-side pending entry completes on first use once tokens land.
 *
 * Params travel over **stdin as JSON**, never argv: `serverConfig` may carry
 * header secrets, and argv is world-visible in `ps`.
 */

/** Hidden subcommand name (see registerAuthCommands in mcp.ts). */
export const AUTH_HELPER_COMMAND = "auth/complete-signin";

/** Params the parent writes to the helper's stdin as one JSON document. */
export type AuthHelperParams = {
  serverConfig: MCPServerConfig;
  serverSettings?: InspectorServerSettings;
};

/** One NDJSON line on the helper's stdout. */
export type AuthHelperEvent =
  | { event: "auth_url"; url: string }
  | { event: "done" }
  | { event: "error"; message: string };

/**
 * Pending sign-in marker, one per flow key (a server URL, or an
 * `ema-idp:<issuer>` key for the EMA IdP login), in the daemon dir (0700).
 * A repeat `connect` while a helper is still waiting must reprint the SAME
 * URL rather than mint a second flow: the fixed loopback callback port makes
 * a second listener fail, and a fresh PKCE state would stale the link the
 * user is already holding.
 */
export type PendingAuthMarker = {
  url: string;
  pid: number;
  /** Epoch ms; matches the flow's own callback-wait bound. */
  expiresAt: number;
};

/** Matches the interactive flow's 15-minute loopback callback wait. */
export const PENDING_AUTH_TTL_MS = 15 * 60 * 1000;

/** Bound on the parent's wait for the helper to report the auth URL. */
const AUTH_URL_WAIT_MS = 60 * 1000;

/** Bound on the helper's wait for params on stdin (parent writes eagerly). */
const HELPER_STDIN_TIMEOUT_MS = 30 * 1000;

export function pendingAuthMarkerPath(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return path.join(getDaemonDir(), `pending-auth-${hash}.json`);
}

/**
 * Read the marker for `key` if it is still live: unexpired AND its
 * helper process is still running (a killed/crashed helper must not pin a
 * dead URL for up to 15 minutes). Stale markers are removed best-effort.
 */
export function readLivePendingAuthMarker(
  key: string,
): PendingAuthMarker | undefined {
  const markerPath = pendingAuthMarkerPath(key);
  let marker: PendingAuthMarker;
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, "utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as PendingAuthMarker).url !== "string" ||
      typeof (parsed as PendingAuthMarker).pid !== "number" ||
      typeof (parsed as PendingAuthMarker).expiresAt !== "number"
    ) {
      throw new Error("malformed marker");
    }
    marker = parsed as PendingAuthMarker;
  } catch {
    return undefined;
  }
  const live =
    marker.expiresAt > Date.now() &&
    (() => {
      try {
        process.kill(marker.pid, 0);
        return true;
      } catch {
        return false;
      }
    })();
  if (!live) {
    // Deliberately NOT deleted here: unlinking by pathname after the read
    // would race a just-spawned helper replacing the marker (TOCTOU — the
    // rm could delete the fresh URL). Stale markers are inert (re-validated
    // on every read) and the next flow's writePendingAuthMarker replaces
    // them.
    return undefined;
  }
  return marker;
}

/**
 * Remove the pending-auth marker only if THIS process wrote the one on disk.
 * Past the 15-minute TTL a replacement flow may have published a fresh
 * marker at the same shared pathname, and an unconditional rm at helper exit
 * would delete the replacement's URL out from under its callers. A read→rm
 * microsecond window remains (POSIX has no compare-and-delete); losing it
 * costs one extra sign-in prompt, never a wrong URL.
 */
export function removeOwnPendingAuthMarker(markerPath: string) {
  try {
    const onDisk = JSON.parse(
      fs.readFileSync(markerPath, "utf8"),
    ) as PendingAuthMarker;
    if (onDisk.pid === process.pid) fs.rmSync(markerPath, { force: true });
  } catch {
    // Missing or unreadable marker: nothing of ours to clean up.
  }
}

export function writePendingAuthMarker(
  markerPath: string,
  marker: PendingAuthMarker,
) {
  // Recreate exclusively (same symlink hardening as the daemon log): an
  // append/overwrite open would follow a planted symlink and only apply the
  // 0600 mode on create.
  fs.rmSync(markerPath, { force: true });
  fs.writeFileSync(markerPath, `${JSON.stringify(marker)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
}

/** Read the helper's stdin to EOF and parse the params document. */
async function readHelperParams(): Promise<AuthHelperParams> {
  const chunks: Buffer[] = [];
  const body = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("timed out waiting for params on stdin"));
    }, HELPER_STDIN_TIMEOUT_MS);
    timer.unref();
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    process.stdin.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  const parsed = JSON.parse(body) as AuthHelperParams;
  if (typeof parsed !== "object" || parsed === null || !parsed.serverConfig) {
    throw new Error("auth helper params must include serverConfig");
  }
  return parsed;
}

/**
 * Entry point for the hidden helper subcommand. Runs the full interactive
 * OAuth flow with a navigation that reports the authorize URL as an NDJSON
 * event on stdout (instead of printing a prompt line) and never opens a
 * browser — the parent (or the human it relayed the URL to) does that.
 */
export async function runAuthHelper(): Promise<void> {
  // The parent unrefs and exits once it has the URL; every later stdout
  // write would EPIPE without this guard.
  const emit = (event: AuthHelperEvent) => {
    try {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    } catch {
      // Parent is gone; the flow itself is unaffected.
    }
  };
  process.stdout.on("error", () => {});

  const params = await readHelperParams();
  const serverUrl =
    "url" in params.serverConfig ? params.serverConfig.url : undefined;
  let markerPath: string | undefined;
  try {
    await authorizeInFrontend(params.serverConfig, params.serverSettings, {
      makeNavigation: (autoOpenControl) =>
        new CallbackNavigation(async (url) => {
          // Mirror createCliOAuthNavigation's arming: SDK-internal auth()
          // during the plain connect() attempt must not leak a URL the
          // flow isn't listening for yet.
          if (!autoOpenControl.armed) return;
          if (serverUrl !== undefined) {
            markerPath = pendingAuthMarkerPath(serverUrl);
            writePendingAuthMarker(markerPath, {
              url: url.href,
              pid: process.pid,
              expiresAt: Date.now() + PENDING_AUTH_TTL_MS,
            });
          }
          emit({ event: "auth_url", url: url.href });
        }),
    });
    emit({ event: "done" });
  } catch (error) {
    emit({
      event: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    if (markerPath !== undefined) removeOwnPendingAuthMarker(markerPath);
  }
}

/**
 * Atomically reserve the right to spawn the sign-in helper for one server.
 * `wx` creation is the atomicity (O_EXCL also refuses a planted symlink).
 *
 * A leftover lock from a crashed reserver is stolen once it is older than
 * the URL wait window. The steal claims the specific stale file by an
 * atomic rename to a per-pid path — concurrent stealers cannot both win,
 * and a winner that renamed a lock which turned out to be fresh backs off
 * (POSIX has no compare-and-delete; the rename makes the claim itself
 * exclusive, which is what prevents a double spawn).
 *
 * @returns true if this process holds the reservation.
 */
function tryReserveAuthFlow(lockPath: string): boolean {
  const isStale = (mtimeMs: number) =>
    Date.now() - mtimeMs > AUTH_URL_WAIT_MS + 5_000;
  const create = () =>
    fs.writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
  try {
    create();
    return true;
  } catch {
    try {
      if (!isStale(fs.statSync(lockPath).mtimeMs)) return false;
      // Claim the stale lock atomically: only one renamer succeeds.
      const claimPath = `${lockPath}.claim-${process.pid}`;
      fs.renameSync(lockPath, claimPath);
      const claimedFresh = !isStale(fs.statSync(claimPath).mtimeMs);
      fs.rmSync(claimPath, { force: true });
      // The claimed file was recreated fresh between stat and rename: an
      // active reserver holds the flow — back off and wait for its marker.
      // (Un-injectable microsecond race; the guard is what matters.)
      /* v8 ignore next */
      if (claimedFresh) return false;
      create();
      return true;
    } catch {
      // Lock vanished, was claimed by another stealer, or was recreated
      // mid-steal: treat as held by another process.
      return false;
    }
  }
}

/**
 * Another connect holds the flow reservation: wait for its helper to publish
 * the marker and reuse that URL instead of spawning a competing helper.
 */
async function waitForPendingAuthUrl(
  serverUrl: string,
  waitMs: number,
  pollMs: number,
): Promise<string> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const marker = readLivePendingAuthMarker(serverUrl);
    if (marker !== undefined) return marker.url;
    if (Date.now() >= deadline) {
      throw new CliExitCodeError(
        EXIT_CODES.AUTH_REQUIRED,
        "Timed out waiting for the in-progress sign-in flow to produce an authorization URL.",
        { code: "auth_required" },
      );
    }
    await new Promise<void>((resolve) => {
      // NOT unref'ed: for a reservation loser this timer may be the only
      // live handle, and an unref'ed one would let Node exit cleanly
      // mid-wait — the connect would print no authorization URL at all.
      setTimeout(resolve, pollMs);
    });
  }
}

/**
 * Non-TTY connect path: return the authorize URL for `serverConfig`, either
 * from a still-live pending marker (helper already waiting — reuse its URL)
 * or by spawning a fresh detached helper and reading the URL off its stdout.
 *
 * The marker check and helper spawn are made atomic by a per-server lock
 * file: concurrent connects for the same server would otherwise both pass
 * the check and spawn helpers that contend for the OAuth callback port. The
 * loser of the reservation waits for the winner's helper to publish the
 * marker (written before the helper reports the URL) and reuses it.
 *
 * After this resolves the helper is unrefed and survives this process: it
 * holds the loopback callback listener and completes the token exchange when
 * the user finishes signing in.
 */
export async function obtainPendingAuthUrl(
  serverConfig: MCPServerConfig,
  serverSettings: InspectorServerSettings | undefined,
  options?: { helperArgv1?: string; waitMs?: number; pollMs?: number },
): Promise<string> {
  const serverUrl = "url" in serverConfig ? serverConfig.url : undefined;
  return obtainPendingUrlForKey(
    serverUrl,
    AUTH_HELPER_COMMAND,
    { serverConfig, serverSettings },
    options,
  );
}

/**
 * Shared engine behind {@link obtainPendingAuthUrl} and the EMA login's
 * non-TTY park (ema-login-helper.ts): marker reuse, flow reservation, helper
 * spawn. `markerKey` is any stable string identifying the one flow callers
 * must share (a server URL, an `ema-idp:<issuer>` key); `undefined` skips
 * marker reuse entirely and always spawns (stdio configs have no URL to key
 * on).
 */
export async function obtainPendingUrlForKey(
  markerKey: string | undefined,
  helperCommand: string,
  helperParams: unknown,
  options?: { helperArgv1?: string; waitMs?: number; pollMs?: number },
): Promise<string> {
  const waitMs = options?.waitMs ?? AUTH_URL_WAIT_MS;
  let lockPath: string | undefined;
  if (markerKey !== undefined) {
    const marker = readLivePendingAuthMarker(markerKey);
    if (marker !== undefined) return marker.url;
    lockPath = `${pendingAuthMarkerPath(markerKey)}.lock`;
    if (!tryReserveAuthFlow(lockPath)) {
      return waitForPendingAuthUrl(markerKey, waitMs, options?.pollMs ?? 250);
    }
  }

  try {
    return await spawnAuthHelperForUrl(
      helperCommand,
      helperParams,
      waitMs,
      options?.helperArgv1,
    );
  } finally {
    // Success: the helper's marker is already on disk (written before the
    // URL event), so later connects reuse it. Failure: releasing lets the
    // next attempt spawn a fresh helper.
    if (lockPath !== undefined) fs.rmSync(lockPath, { force: true });
  }
}

/** Spawn the detached helper and read the authorize URL off its stdout. */
async function spawnAuthHelperForUrl(
  helperCommand: string,
  helperParams: unknown,
  waitMs: number,
  helperArgv1?: string,
): Promise<string> {
  /* v8 ignore next 6 -- argv[1] is always the mcpdo bin in production. */
  const script = helperArgv1 ?? process.argv[1];
  if (!script) {
    throw new CliExitCodeError(
      EXIT_CODES.USAGE,
      "Cannot locate the mcpdo entry script to spawn the sign-in helper.",
      { code: "usage" },
    );
  }
  const child = spawn(process.execPath, [script, helperCommand], {
    detached: true,
    stdio: ["pipe", "pipe", "ignore"],
    env: process.env,
  });
  child.stdin.on("error", () => {});
  child.stdin.write(JSON.stringify(helperParams));
  child.stdin.end();

  try {
    return await new Promise<string>((resolve, reject) => {
      let buffer = "";
      const fail = (message: string) => {
        reject(
          new CliExitCodeError(EXIT_CODES.AUTH_REQUIRED, message, {
            code: "auth_required",
          }),
        );
      };
      const timer = setTimeout(() => {
        fail(
          "Timed out waiting for the sign-in helper to produce an authorization URL.",
        );
      }, waitMs);
      timer.unref();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          let event: AuthHelperEvent;
          try {
            event = JSON.parse(line) as AuthHelperEvent;
          } catch {
            continue;
          }
          if (event.event === "auth_url") {
            clearTimeout(timer);
            resolve(event.url);
            return;
          }
          if (event.event === "error") {
            clearTimeout(timer);
            // The helper relays server-derived text; strip C0/C1 controls
            // before it reaches a terminal via the error envelope.
            fail(`Sign-in helper failed: ${sanitizeText(event.message)}`);
            return;
          }
        }
      });
      // "close", not "exit": exit can fire while the final stdout line
      // (e.g. `{"event":"error",...}`) is still buffered; close waits for
      // the stdio streams to drain so that line is parsed first.
      child.on("close", (code) => {
        clearTimeout(timer);
        fail(
          `Sign-in helper exited (code ${String(code)}) before producing an authorization URL.`,
        );
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        fail(`Failed to spawn sign-in helper: ${error.message}`);
      });
    });
  } finally {
    // Release the helper: close our ends of its pipes and drop it from this
    // process's ref graph so `connect` can exit while it keeps waiting.
    child.stdout.destroy();
    child.unref();
  }
}
