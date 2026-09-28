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
type AuthHelperEvent =
  | { event: "auth_url"; url: string }
  | { event: "done" }
  | { event: "error"; message: string };

/**
 * Pending sign-in marker, one per server URL, in the daemon dir (0700).
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
const PENDING_AUTH_TTL_MS = 15 * 60 * 1000;

/** Bound on the parent's wait for the helper to report the auth URL. */
const AUTH_URL_WAIT_MS = 60 * 1000;

/** Bound on the helper's wait for params on stdin (parent writes eagerly). */
const HELPER_STDIN_TIMEOUT_MS = 30 * 1000;

export function pendingAuthMarkerPath(serverUrl: string): string {
  const hash = createHash("sha256")
    .update(serverUrl)
    .digest("hex")
    .slice(0, 16);
  return path.join(getDaemonDir(), `pending-auth-${hash}.json`);
}

/**
 * Read the marker for `serverUrl` if it is still live: unexpired AND its
 * helper process is still running (a killed/crashed helper must not pin a
 * dead URL for up to 15 minutes). Stale markers are removed best-effort.
 */
export function readLivePendingAuthMarker(
  serverUrl: string,
): PendingAuthMarker | undefined {
  const markerPath = pendingAuthMarkerPath(serverUrl);
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
    fs.rmSync(markerPath, { force: true });
    return undefined;
  }
  return marker;
}

function writePendingAuthMarker(markerPath: string, marker: PendingAuthMarker) {
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
    if (markerPath !== undefined) {
      fs.rmSync(markerPath, { force: true });
    }
  }
}

/**
 * Non-TTY connect path: return the authorize URL for `serverConfig`, either
 * from a still-live pending marker (helper already waiting — reuse its URL)
 * or by spawning a fresh detached helper and reading the URL off its stdout.
 *
 * After this resolves the helper is unrefed and survives this process: it
 * holds the loopback callback listener and completes the token exchange when
 * the user finishes signing in.
 */
export async function obtainPendingAuthUrl(
  serverConfig: MCPServerConfig,
  serverSettings: InspectorServerSettings | undefined,
  options?: { helperArgv1?: string },
): Promise<string> {
  const serverUrl = "url" in serverConfig ? serverConfig.url : undefined;
  if (serverUrl !== undefined) {
    const marker = readLivePendingAuthMarker(serverUrl);
    if (marker !== undefined) return marker.url;
  }

  /* v8 ignore next 6 -- argv[1] is always the mcpdo bin in production. */
  const script = options?.helperArgv1 ?? process.argv[1];
  if (!script) {
    throw new CliExitCodeError(
      EXIT_CODES.USAGE,
      "Cannot locate the mcpdo entry script to spawn the sign-in helper.",
      { code: "usage" },
    );
  }
  const child = spawn(process.execPath, [script, AUTH_HELPER_COMMAND], {
    detached: true,
    stdio: ["pipe", "pipe", "ignore"],
    env: process.env,
  });
  child.stdin.on("error", () => {});
  child.stdin.write(JSON.stringify({ serverConfig, serverSettings }));
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
      }, AUTH_URL_WAIT_MS);
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
            fail(`Sign-in helper failed: ${event.message}`);
            return;
          }
        }
      });
      child.on("exit", (code) => {
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
