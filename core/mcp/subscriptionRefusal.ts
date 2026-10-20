import { SdkErrorCode, SdkHttpError } from "@modelcontextprotocol/client";
import type { SubscriptionListenRefusal } from "./types.js";

/**
 * Recognizing a modern-era `subscriptions/listen` the server refused at the
 * HTTP layer with a status a retry cannot change (#2722).
 *
 * The sibling of the never-acknowledged close in `subscriptionAck.ts` (#2097):
 * both are deterministic answers, and both used to be fed to the reconnect
 * machinery as though they were drops — eight re-lists over roughly a minute,
 * then a bare "Stream ended" that said nothing about why. That module covers
 * a listen the server closed before acknowledging; this one covers a listen the
 * server would not accept at all.
 *
 * The SDK surfaces every non-auth HTTP failure of a POST as an `SdkHttpError`
 * with the same code, `ClientHttpNotImplemented`, so the HTTP status in its data
 * is the only thing that tells a refusal from a transient failure. The auth
 * statuses never arrive with that code: a 401, and a 403 carrying
 * `insufficient_scope`, go through the auth flow and surface (if at all) under
 * the SDK's auth codes. Requiring the code as well as the status is what keeps
 * them out of this predicate.
 */

/**
 * The HTTP statuses that refuse a listen deterministically. A 403 reaching this
 * point carries no `insufficient_scope` challenge (see above), so it is a plain
 * "forbidden" with no auth flow to run. 400/404/405 say the request or the
 * endpoint is wrong, which re-sending the same filter cannot fix.
 *
 * Everything else stays retryable — notably 5xx, 408 and 429, which are the
 * statuses that mean "try again later".
 */
const REFUSAL_STATUSES: ReadonlySet<number> = new Set([400, 403, 404, 405]);

/**
 * The refusal a rejected `listen()` represents, or `undefined` when the failure
 * is one a retry may fix (a transport failure, a timeout, a transient HTTP
 * status, or anything that is not an `SdkHttpError` at all).
 */
export function subscriptionListenRefusal(
  error: unknown,
): SubscriptionListenRefusal | undefined {
  if (
    !SdkHttpError.isInstance(error) ||
    error.code !== SdkErrorCode.ClientHttpNotImplemented ||
    !REFUSAL_STATUSES.has(error.status)
  ) {
    return undefined;
  }
  return {
    status: error.status,
    ...(error.statusText ? { statusText: error.statusText } : {}),
  };
}

/**
 * The explanation shown to the user, in the UI and in the client log. Lives in
 * `core/` so every client says the same thing about the same wire event.
 */
export function subscriptionListenRefusalMessage(
  refusal: SubscriptionListenRefusal,
): string {
  const status = refusal.statusText
    ? `${refusal.status} ${refusal.statusText}`
    : String(refusal.status);
  return `The server refused subscriptions/listen (HTTP ${status}). Not retrying — the server would answer the same way again.`;
}
