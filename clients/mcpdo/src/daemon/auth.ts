import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs";
import {
  CliExitCodeError,
  EXIT_CODES,
} from "@inspector/core/cli/error-handler.js";
import { DAEMON_TOKEN_ENV, getDaemonTokenPath } from "./paths.js";

/** Fresh random IPC token for a daemon whose environment didn't supply one. */
export function generateDaemonToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Read the token a running daemon published to `mcpdod.token` (see
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
 * to `mcpdod.token` for same-user clients to read. Every daemon requires a
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

/**
 * Domain separation for {@link computeDaemonProof}: the token keys this MAC
 * and nothing else, so a proof can never be mistaken for any other value
 * derived from the same key.
 */
const DAEMON_PROOF_CONTEXT = "mcpdo-daemon-proof-v1\0";

/** A hello nonce is 32 random bytes, hex-encoded. */
const DAEMON_NONCE_PATTERN = /^[0-9a-f]{64}$/;

/** Fresh per-connection challenge the client sends in its `hello`. */
export function generateDaemonNonce(): string {
  return randomBytes(32).toString("hex");
}

/** True when `value` has the shape {@link generateDaemonNonce} produces. */
export function isDaemonNonce(value: unknown): value is string {
  return typeof value === "string" && DAEMON_NONCE_PATTERN.test(value);
}

/**
 * The daemon's answer to a client's `hello`: HMAC-SHA256 over the client's
 * nonce, keyed by the IPC token. Only a process holding the token can produce
 * it, and a fresh nonce per connection means a recorded answer is worthless.
 *
 * This is what authenticates the DAEMON to the client. The token itself only
 * authenticates the client to the daemon, and the endpoint name alone proves
 * nothing: on Windows the daemon's named pipe lives in a machine-wide
 * namespace, so another local user can create a pipe of the same name while
 * this user's daemon is not running. The client therefore sends neither its
 * token nor any request payload until the peer has answered with this proof.
 */
export function computeDaemonProof(token: string, nonce: string): string {
  return createHmac("sha256", token)
    .update(DAEMON_PROOF_CONTEXT)
    .update(nonce)
    .digest("hex");
}

/** Constant-time check of a peer's {@link computeDaemonProof} answer. */
export function verifyDaemonProof(
  token: string,
  nonce: string,
  proof: unknown,
): boolean {
  if (typeof proof !== "string") return false;
  return tokensEqual(computeDaemonProof(token, nonce), proof);
}
