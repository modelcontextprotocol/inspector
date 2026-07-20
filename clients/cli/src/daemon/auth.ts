import { timingSafeEqual } from "node:crypto";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import { DAEMON_TOKEN_ENV } from "./paths.js";

/**
 * Read the IPC token from the environment (parent client or daemon child).
 * Empty / unset → shared (unauthenticated) mode.
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
