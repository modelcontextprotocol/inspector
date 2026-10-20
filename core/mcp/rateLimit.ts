/**
 * Rate-limit recognition: the one place that turns a server's `HTTP 429` into
 * a message saying the server is throttling, and when it says to retry
 * (#2442).
 *
 * Before this, a throttled request surfaced as the SDK's
 * `Error POSTing to endpoint: <body>` — the same shape as every other non-OK
 * status, so telling "the server is down" from "the server is pacing me" was
 * left to the reader. Both facts needed to say more were already in-process:
 * the error carries the status, and the fetch tracker recorded the response's
 * `Retry-After` header.
 *
 * The header has to come from the tracker because the SDK's `SdkHttpError`
 * keeps the status and the body but none of the response headers. It is
 * matched to its error by JSON-RPC id, not by time: a {@link RateLimitLedger}
 * files each 429's header under the request id(s) in the tracked request body,
 * and the code that sees the failed send — which knows the message it was
 * sending — takes that id's header and stamps it onto the error's data as
 * `retryAfter` ({@link attachRetryAfter}). Two requests throttled at once
 * therefore each report their own server's word, whatever order their
 * responses land in.
 *
 * Where the upstream fetch runs in the web backend, the backend does the
 * stamping from its own ledger and relays `retryAfter` on the send error (see
 * `RemoteHttpErrorData`), so the browser does not depend on a fetch event
 * racing the send's HTTP response across two connections. Either way, by the
 * time {@link annotateRateLimit} sees the error, the header is on it.
 *
 * Deliberately narrow: only a 429 is recognized. A 503 also carries
 * `Retry-After` but means "unavailable", which is exactly the case this exists
 * to tell apart from throttling.
 */

import {
  SdkHttpError,
  type SdkHttpErrorData,
} from "@modelcontextprotocol/client";
import { findHeader } from "./fetchTracking.js";
import { formatDuration } from "./connectionDiagnostics.js";
import type { FetchRequestEntryBase } from "./types.js";

/** `429 Too Many Requests` (RFC 6585). */
export const HTTP_TOO_MANY_REQUESTS = 429;

/**
 * The JSON-RPC request ids in a tracked request body: one for a single
 * request, several for a batch, none for a notification, a response, or a
 * body that is not JSON. The tracker records the body redacted, but redaction
 * masks only sensitive string fields, so `id` survives it.
 */
export function requestIdsOf(body: string | undefined): (string | number)[] {
  if (body === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const messages: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const ids: (string | number)[] = [];
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    if (!("method" in message) || !("id" in message)) continue;
    const { id } = message;
    if (typeof id === "string" || typeof id === "number") ids.push(id);
  }
  return ids;
}

/**
 * How many unclaimed 429s a ledger holds before it drops the oldest. A 429 is
 * normally claimed within the same tick its send fails; one that never is (a
 * send aborted mid-flight is not reported as a failure) would otherwise stay
 * for the rest of the session.
 */
export const MAX_UNCLAIMED_RATE_LIMITS = 100;

/**
 * Each tracked 429's `Retry-After`, filed under the JSON-RPC id of the request
 * that drew it, until the failed send for that id claims it.
 */
export class RateLimitLedger {
  // `undefined` is a real value here: a 429 that carried no header.
  private readonly byRequestId = new Map<string | number, string | undefined>();

  /** File a tracked fetch, if it was a 429. Anything else is ignored. */
  record(entry: FetchRequestEntryBase): void {
    if (entry.responseStatus !== HTTP_TOO_MANY_REQUESTS) return;
    const retryAfter = findHeader(entry.responseHeaders, "retry-after");
    for (const id of requestIdsOf(entry.requestBody)) {
      this.byRequestId.delete(id);
      this.byRequestId.set(id, retryAfter);
      if (this.byRequestId.size > MAX_UNCLAIMED_RATE_LIMITS) {
        const [oldest] = this.byRequestId.keys();
        /* v8 ignore next -- size > 0 was just checked, so a first key exists */
        if (oldest !== undefined) this.byRequestId.delete(oldest);
      }
    }
  }

  /** The `Retry-After` filed for `id`, removed as it is read. */
  take(id: string | number): string | undefined {
    const retryAfter = this.byRequestId.get(id);
    this.byRequestId.delete(id);
    return retryAfter;
  }

  clear(): void {
    this.byRequestId.clear();
  }
}

/**
 * The IMF-fixdate form of an HTTP-date (`Sun, 06 Nov 1994 08:49:37 GMT`),
 * which RFC 9110 §5.6.7 requires senders to use. Matched before `Date.parse`
 * because `Date.parse` is lenient past usefulness: it reads `-5` as the year
 * 5 BC, which would report a malformed header as "retry now".
 */
const IMF_FIXDATE =
  /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * A `Retry-After` value as a delay in ms from `now` (RFC 9110 §10.2.3): either
 * a non-negative integer count of seconds, or an HTTP-date. A date already in
 * the past is a delay of `0`. Anything else is `undefined` — a malformed header
 * is reported verbatim rather than guessed at.
 */
export function parseRetryAfter(
  value: string | undefined,
  now: number,
): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  if (!IMF_FIXDATE.test(trimmed)) return undefined;
  const at = Date.parse(trimmed);
  // A well-formed shape can still name no real date (`Mon, 99 Foo 2026 …`).
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

/** Whether `err` is the SDK's HTTP error for a `429 Too Many Requests`. */
export function isRateLimitError(err: unknown): err is SdkHttpError {
  return SdkHttpError.isInstance(err) && err.status === HTTP_TOO_MANY_REQUESTS;
}

/**
 * The data carried by an annotated rate-limit error: the SDK's own HTTP data,
 * plus the method that was throttled and the retry timing when the server
 * gave one. Exposed so a consumer that wants the structured form (a countdown,
 * a CLI's JSON output) can read it off `error.data` instead of parsing the
 * message.
 */
export interface AnnotatedRateLimitData extends SdkHttpErrorData {
  method: string;
  /** The raw `Retry-After` header, when the server sent one. */
  retryAfter?: string;
  /** The parsed delay, when `retryAfter` was well-formed. */
  retryAfterMs?: number;
}

function retryAfterOn(err: SdkHttpError): string | undefined {
  const value = err.data.retryAfter;
  return typeof value === "string" ? value : undefined;
}

/**
 * Stamp a 429's own `Retry-After` onto its error's data, where
 * {@link annotateRateLimit} reads it. A header already there wins: on the
 * browser's remote transport the backend relayed it from the upstream
 * response itself, which nothing on this side can know better. Anything that
 * is not a 429, or a missing header, leaves the error untouched.
 */
export function attachRetryAfter(
  err: unknown,
  retryAfter: string | undefined,
): void {
  if (!isRateLimitError(err) || retryAfter === undefined) return;
  if (retryAfterOn(err) !== undefined) return;
  err.data.retryAfter = retryAfter;
}

function describeRetry(
  retryAfter: string | undefined,
  retryAfterMs: number | undefined,
): string {
  if (retryAfterMs !== undefined) {
    return `The server asked to retry after ${formatDuration(retryAfterMs)}.`;
  }
  if (retryAfter !== undefined) {
    return `The server sent an unparseable Retry-After (${retryAfter}).`;
  }
  return "The server sent no Retry-After header.";
}

/**
 * Rebuild a 429 `SdkHttpError` with a message that names it as rate limiting,
 * says which request was throttled, and gives the retry timing when the server
 * sent one.
 *
 * The header is read off the error's own data, where {@link attachRetryAfter}
 * (or the backend relay) put it.
 *
 * Anything that is not a 429 is returned untouched, so this is safe to apply
 * blindly on the rejection path of every request. The result keeps the
 * original's code and HTTP data, so a status or code check downstream sees
 * what it saw before; the original is kept as `cause`.
 */
export function annotateRateLimit(
  err: unknown,
  method: string,
  now: number = Date.now(),
): unknown {
  if (!isRateLimitError(err)) return err;
  const header = retryAfterOn(err);
  const retryAfterMs = parseRetryAfter(header, now);
  const data: AnnotatedRateLimitData = {
    ...err.data,
    method,
    ...(header !== undefined && { retryAfter: header }),
    ...(retryAfterMs !== undefined && { retryAfterMs }),
  };
  const message = `Rate limited by the server (HTTP 429) on ${method}. ${describeRetry(header, retryAfterMs)} ${err.message}`;
  return new SdkHttpError(err.code, message, data, { cause: err });
}
