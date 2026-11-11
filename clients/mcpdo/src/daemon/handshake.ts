/**
 * Client half of the daemon `hello` handshake: verify the peer on the other
 * end of the daemon endpoint holds this user's IPC token BEFORE sending the
 * token or any request payload.
 *
 * Why: the token authenticates the client to the daemon, but nothing used to
 * authenticate the daemon to the client. On Windows the daemon endpoint is a
 * named pipe in a machine-wide namespace with a name derived from a
 * predictable directory, so while this user's daemon is not running another
 * local user can create a pipe of the same name. A client that trusted
 * whatever answered there would hand it the token and every `connect`'s
 * server config (URLs, headers, stdio env), and accept forged results.
 *
 * So every connection opens with `hello { nonce }`; the daemon answers with
 * HMAC-SHA256(token, nonce) (`computeDaemonProof`), and only a verified
 * answer releases the real request. Unix sockets live in a 0700 directory and
 * were not exposed this way, but the check runs on every platform: it costs
 * one round trip and keeps a single code path.
 */
import { randomUUID } from "node:crypto";
import {
  CliExitCodeError,
  EXIT_CODES,
} from "@inspector/core/cli/error-handler.js";
import { generateDaemonNonce, verifyDaemonProof } from "./auth.js";
import { encodeRequest } from "./framing.js";
import type { DaemonResponse, HelloParams, HelloResult } from "./protocol.js";

export type DaemonHello = {
  id: string;
  nonce: string;
  /** NDJSON line to write as the connection's first bytes. */
  line: string;
};

/** A fresh `hello` request. Carries no token and no payload. */
export function createDaemonHello(): DaemonHello {
  const id = randomUUID();
  const nonce = generateDaemonNonce();
  const params: HelloParams = { nonce };
  return { id, nonce, line: encodeRequest({ id, op: "hello", params }) };
}

/**
 * Error for a peer that did not prove it holds the token. Says nothing the
 * peer sent: its text is untrusted, and the remedy does not depend on it.
 */
export function daemonUnverifiedError(socketPath: string): CliExitCodeError {
  return new CliExitCodeError(
    EXIT_CODES.UNREACHABLE,
    `Could not verify the connection daemon at ${socketPath}: it did not prove it holds this user's daemon token, so nothing was sent to it. ` +
      "Either MCP_INSPECTOR_DAEMON_TOKEN does not match the running daemon's token, " +
      "or a daemon from an older mcpdo release is still running (end the `mcpdod` process, then re-run the command), " +
      "or another process is impersonating the daemon.",
    { code: "daemon_unverified" },
  );
}

/**
 * Error for a client that holds no token at all yet reached something on the
 * daemon endpoint. Without a token it cannot verify that peer, so it sends it
 * nothing — the case that matters is a daemon that has shut down (removing
 * `mcpdod.token`) and an impostor now answering on its endpoint. (When
 * nothing answers, the caller reports `daemon_unreachable` as before.)
 */
export function daemonTokenMissingError(tokenPath: string): CliExitCodeError {
  return new CliExitCodeError(
    EXIT_CODES.UNREACHABLE,
    `No connection daemon token found (${tokenPath}), so the daemon cannot be verified and nothing was sent. ` +
      "Re-run the command to start a fresh daemon; if this persists, another process may be holding the daemon endpoint.",
    { code: "daemon_unverified" },
  );
}

/**
 * Check one line received during the handshake. The FIRST non-blank line must
 * be the answer to our `hello` and carry a valid proof; anything else fails.
 * Returns undefined when verified, else the error to fail the call with.
 */
export function checkDaemonHelloLine(
  line: string,
  hello: DaemonHello,
  token: string | undefined,
  socketPath: string,
): CliExitCodeError | undefined {
  // No token, no verification: never fall back to accepting the peer.
  if (token === undefined) return daemonUnverifiedError(socketPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return daemonUnverifiedError(socketPath);
  }
  if (parsed === null || typeof parsed !== "object") {
    return daemonUnverifiedError(socketPath);
  }
  const response = parsed as Partial<DaemonResponse>;
  if (response.id !== hello.id || response.ok !== true) {
    return daemonUnverifiedError(socketPath);
  }
  const result = (response as { result?: Partial<HelloResult> | null }).result;
  if (!verifyDaemonProof(token, hello.nonce, result?.proof)) {
    return daemonUnverifiedError(socketPath);
  }
  return undefined;
}
