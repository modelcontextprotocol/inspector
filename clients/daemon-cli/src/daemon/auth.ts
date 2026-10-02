import { randomBytes, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs";
import { CliExitCodeError, EXIT_CODES } from "@inspector/cli/error-handler.js";
import { DAEMON_TOKEN_ENV, getDaemonTokenPath } from "./paths.js";

/** Fresh random IPC token for a daemon whose environment didn't supply one. */
export function generateDaemonToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Read the token a running daemon published to `daemon.token` (see
 * {@link getDaemonTokenPath}). Undefined when missing/unreadable — the
 * request will then fail authentication with a clear error.
 */
export function readDaemonTokenFile(dir?: string): string | undefined {
  try {
    const token = fs.readFileSync(getDaemonTokenPath(dir), "utf8").trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the IPC token from the environment (parent client or daemon child).
 * Empty / unset → shared mode, which is still authenticated: the daemon
 * generates its own required token (see `daemon/run.ts`) and publishes it
 * to `daemon.token` for same-user clients to read. Every daemon requires a
 * token; the environment variable only selects who supplies it.
 */
export function getDaemonTokenFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const token = env[DAEMON_TOKEN_ENV]?.trim();
  return token || undefined;
}

/** Constant-time compare; false if either side is missing or lengths differ. */
export function tokensEqual(
  expected: string | undefined,
  provided: string | undefined,
): boolean {
  if (expected === undefined || provided === undefined) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * When {@link requiredToken} is set, reject requests that omit or mismatch it.
 */
export function assertDaemonToken(
  requiredToken: string | undefined,
  provided: string | undefined,
): void {
  if (requiredToken === undefined) return;
  if (!tokensEqual(requiredToken, provided)) {
    throw new CliExitCodeError(
      EXIT_CODES.USAGE,
      "Daemon IPC authentication failed (missing or invalid token).",
      { code: "daemon_auth_failed" },
    );
  }
}
