import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client";

/**
 * Recognizing the "server closed the subscription without ever acknowledging
 * it" failure of a modern-era `subscriptions/listen` (#2097).
 *
 * A `subscriptions/listen` request is long-lived: the first message on the
 * stream MUST be `notifications/subscriptions/acknowledged`, and the JSON-RPC
 * `result` for the listen id is reserved as the *graceful-closure* marker
 * (2026-07-28 spec, Subscriptions → Graceful Closure). A server that answers the
 * listen request with a bare `result` and never acknowledges is therefore saying
 * "acknowledged and closed in the same breath": the SDK settles the subscription
 * with cause `"graceful"` and rejects the pending `listen()` promise.
 *
 * That is a *deterministic* condition — the same server answers the same way
 * every time — so it must not be retried, and it is not the same event as a
 * graceful shutdown of an established stream. Without the distinction the
 * Inspector re-listed eight times over roughly a minute and settled on a bare
 * "Stream ended" badge that said nothing about why (#2063).
 */

/**
 * The distinguishing fragment of the SDK's rejection message for this case.
 *
 * The SDK does not give the never-acknowledged close a code of its own — it is
 * an `SdkError(ConnectionClosed)`, the same code a stream closed for any other
 * reason before acknowledgement carries — so the message is the only thing that
 * separates them. Matching it is deliberately narrow rather than clever: the
 * alternative is treating *every* pre-ack `ConnectionClosed` as deterministic
 * and refusing to retry a genuinely transient drop.
 *
 * The live check on this string is the integration test in
 * `inspectorClient-subscriptions-era.test.ts`, which drives a real server that
 * answers `subscriptions/listen` with a bare result; an SDK that rephrases the
 * message fails there rather than silently reverting to the eight-retry
 * behavior.
 */
const NEVER_ACKNOWLEDGED_SDK_MESSAGE =
  "closed the subscription gracefully before acknowledging";

/**
 * The explanation shown to the user, in the UI and in the client log. Lives in
 * `core/` so every client says the same thing about the same wire event.
 */
export const NEVER_ACKNOWLEDGED_SUBSCRIPTION_MESSAGE =
  "The server closed the subscription without acknowledging it. A subscriptions/listen request must first be answered with a notifications/subscriptions/acknowledged notification; a JSON-RPC result for the listen id means graceful closure. Not retrying — the server would answer the same way again.";

/**
 * True when a rejected `listen()` is the never-acknowledged close above, rather
 * than a transport failure, a timeout, or a pre-ack error response — each of
 * which may well succeed on a retry.
 */
export function isNeverAcknowledgedSubscriptionClose(
  error: unknown,
): error is SdkError {
  return (
    SdkError.isInstance(error) &&
    error.code === SdkErrorCode.ConnectionClosed &&
    error.message.includes(NEVER_ACKNOWLEDGED_SDK_MESSAGE)
  );
}

/**
 * The sentence to report for a failed subscribe/unsubscribe. For the
 * never-acknowledged close that is the explanation above rather than the SDK's
 * own wording, which names the wire event without saying what the Inspector did
 * about it (nothing further) — the omission #2097 is about. Every other failure
 * keeps its own message, which is the diagnostic.
 */
export function subscriptionFailureMessage(error: unknown): string {
  if (isNeverAcknowledgedSubscriptionClose(error)) {
    return NEVER_ACKNOWLEDGED_SUBSCRIPTION_MESSAGE;
  }
  return error instanceof Error ? error.message : String(error);
}
