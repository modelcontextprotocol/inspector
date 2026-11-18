/**
 * Fake-daemon support for suites that stand up a bare `net.Server` in place
 * of a real {@link DaemonServer}.
 *
 * Every client connection now opens with a `hello` the peer must answer with
 * HMAC(token, nonce) before the client sends its request (see
 * `src/daemon/handshake.ts`). A fake that only wants to script the response to
 * that request therefore needs two things a real daemon has: a published
 * `mcpdod.token` the client can read, and a valid answer to the hello. These
 * helpers provide both so each fake stays about the request it is testing.
 */
import * as fs from "node:fs";
import type * as net from "node:net";
import { computeDaemonProof } from "../../src/daemon/auth.js";
import { getDaemonTokenPath } from "../../src/daemon/paths.js";

/** Token the fakes hold, unless a test passes its own. */
export const FAKE_DAEMON_TOKEN = "fake-daemon-token";

/**
 * Publish `token` as `mcpdod.token` in the fake's daemon directory, where a
 * client passed that `dir` looks for it. Keyed by the directory rather than
 * the endpoint: on Windows the endpoint is a named pipe, which has no
 * directory to derive (see `helpers/daemon-endpoint.ts`).
 */
export function publishFakeDaemonToken(
  dir: string,
  token: string = FAKE_DAEMON_TOKEN,
): void {
  fs.writeFileSync(getDaemonTokenPath(dir), token, { mode: 0o600 });
}

/** The proof a genuine daemon holding `token` returns for one hello line. */
export function answerHelloLine(line: string, token: string): string {
  const hello = JSON.parse(line) as { id: string; params: { nonce: string } };
  return (
    JSON.stringify({
      id: hello.id,
      ok: true,
      result: { proof: computeDaemonProof(token, hello.params.nonce) },
    }) + "\n"
  );
}

/**
 * `socket.once("data", handler)` for the client's REAL request: answers the
 * hello first, then hands the next chunk — the request, which the client only
 * writes once the proof checks out — to `handler`.
 */
export function onRequest(
  socket: net.Socket,
  handler: (buf: Buffer) => void,
  token: string = FAKE_DAEMON_TOKEN,
): void {
  socket.once("data", (buf: Buffer) => {
    socket.once("data", handler);
    socket.write(answerHelloLine(String(buf).trim(), token));
  });
}
