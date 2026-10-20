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
 * keeps the status and the body but none of the response headers. Where the
 * upstream fetch runs in the web backend, the backend reads the same header
 * off its own tracked fetch and relays it on the send error as `retryAfter`
 * (see `RemoteHttpErrorData`), so the browser does not depend on a fetch
 * event racing the send's HTTP response across two connections.
 *
 * Everything here is pure. `InspectorClient` owns the bookkeeping, the same
 * split `connectionDiagnostics.ts` makes for request timeouts.
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

/** A rate-limited response the fetch tracker recorded. */
export interface RateLimitResponse {
  /** The raw `Retry-After` header, when the server sent one. */
  retryAfter?: string;
  /** Epoch ms at which the request that drew it went out. */
  sentAt: number;
}

/**
 * The rate-limit facts in a tracked fetch, or `undefined` when the response
 * was not a 429 (or the fetch failed before any response arrived).
 */
export function rateLimitResponseOf(
  entry: FetchRequestEntryBase,
): RateLimitResponse | undefined {
  if (entry.responseStatus !== HTTP_TOO_MANY_REQUESTS) return undefined;
  const retryAfter = findHeader(entry.responseHeaders, "retry-after");
  return {
    ...(retryAfter !== undefined && { retryAfter }),
    sentAt: entry.timestamp.getTime(),
  };
}

/**
 * The latest recorded 429's `Retry-After`, when that 429 answered a request
 * sent at or after `since`. The bound is what keeps a header from a 429
 * minutes ago from being reported against a request it never answered.
 */
export function retryAfterSince(
  latest: RateLimitResponse | undefined,
  since: number,
): string | undefined {
  if (!latest || latest.sentAt < since) return undefined;
  return latest.retryAfter;
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

function relayedRetryAfter(err: SdkHttpError): string | undefined {
  const value = err.data.retryAfter;
  return typeof value === "string" ? value : undefined;
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
 * `retryAfter` is the header the caller tracked; a value the backend relayed on
 * the error itself takes precedence, since it was read off the very response
 * that produced this error.
 *
 * Anything that is not a 429 is returned untouched, so this is safe to apply
 * blindly on the rejection path of every request. The result keeps the
 * original's code and HTTP data, so a status or code check downstream sees
 * what it saw before; the original is kept as `cause`.
 */
export function annotateRateLimit(
  err: unknown,
  method: string,
  retryAfter: string | undefined,
  now: number = Date.now(),
): unknown {
  if (!isRateLimitError(err)) return err;
  const header = relayedRetryAfter(err) ?? retryAfter;
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
