/**
 * Best-effort termination of a Streamable HTTP session on disconnect (#2924).
 *
 * The spec says a client that no longer needs a session SHOULD send an HTTP
 * `DELETE` carrying its `Mcp-Session-Id`. Closing the SDK transport does not do
 * that — `close()` only aborts local streams — so a stateful server kept every
 * session the Inspector opened until its own idle cleanup ran, and a load run
 * with a session cap exhausted it.
 *
 * The SDK's `StreamableHTTPClientTransport.terminateSession()` sends the
 * `DELETE` through the transport's own fetch stack and `_commonHeaders()`, so
 * it carries exactly the auth and custom headers every other request of the
 * session carried, and it already treats a 405 (server does not support
 * termination) as success. This module only adds what a *disconnect* needs on
 * top of that:
 *
 * - **Duck-typed, not `instanceof`.** Two callers hand it a transport: the
 *   `InspectorClient`, whose transport in the browser is the
 *   `RemoteClientTransport` (no session of its own — the web backend holds the
 *   upstream one and terminates it there), and the web backend itself. Asking
 *   for the method keeps this file free of a transport import and lets every
 *   other transport (stdio, legacy SSE) pass through as a no-op.
 * - **Never throws.** A termination failure is the server's problem to clean
 *   up; it must not stop the local teardown that follows.
 * - **Bounded.** A server that accepts the `DELETE` and never answers would
 *   otherwise hold `disconnect()` open indefinitely. On timeout the caller
 *   proceeds to `close()`, which aborts the transport's controller — the same
 *   signal the `DELETE` was sent on — so the request does not outlive the
 *   transport.
 */

/** A transport that can end its server-side session. */
interface SessionTerminatingTransport {
  readonly sessionId?: string;
  terminateSession(): Promise<void>;
}

function canTerminateSession(
  transport: unknown,
): transport is SessionTerminatingTransport {
  return (
    typeof transport === "object" &&
    transport !== null &&
    "terminateSession" in transport &&
    typeof transport.terminateSession === "function"
  );
}

/**
 * How long a disconnect waits for the session `DELETE` before closing anyway.
 * Long enough for a loaded server to answer, short enough that a hung one does
 * not make a user's Disconnect look frozen.
 */
export const SESSION_TERMINATE_TIMEOUT_MS = 3000;

/**
 * Send the session-terminating `DELETE` when `transport` is a Streamable HTTP
 * transport holding a session id; otherwise do nothing. Resolves `true` when
 * the server acknowledged (2xx, or 405), `false` when there was nothing to
 * terminate, the request failed, or it did not answer within `timeoutMs`.
 * Never rejects.
 */
export async function terminateSessionBestEffort(
  transport: unknown,
  timeoutMs: number = SESSION_TERMINATE_TIMEOUT_MS,
): Promise<boolean> {
  if (!canTerminateSession(transport) || !transport.sessionId) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  // Held and settled on both paths: on a timeout the DELETE is still pending
  // and rejects once the caller's close() aborts it, so the `catch` here is
  // what keeps that rejection from going unhandled. Invoked inside the
  // executor so a transport that throws synchronously takes the same path.
  const terminated = new Promise<void>((resolve) =>
    resolve(transport.terminateSession()),
  ).then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([terminated, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
