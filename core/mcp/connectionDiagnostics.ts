/**
 * Connection diagnostics: what the client is still waiting on, when it last
 * heard back, and the state of the server-to-client notification stream — and
 * the one place that turns the SDK's bare `Request timed out` into a message
 * that reports those facts (#2318).
 *
 * The motivating case is #2187: a server that serves one request at a time.
 * The standalone `GET /mcp` stream the client opens after `initialize`
 * occupies that single slot, so `initialize` succeeds and every request after
 * it hangs — and the Inspector's only word on it was `Request timed out`,
 * which names the symptom the user can already see. Every fact needed to
 * suspect the cause was already in-process at that moment: the stream had been
 * open for the whole session and delivered nothing, `tools/list` had been
 * outstanding for 60s, and nothing had been answered since `initialize`.
 *
 * Everything here is pure. `InspectorClient` owns the bookkeeping (it sees
 * every outbound request, every inbound response and every tracked fetch) and
 * hands a snapshot to {@link annotateRequestTimeout}; the UI clients render the
 * same snapshot through `getConnectionDiagnostics()`.
 *
 * Deliberately factual: the summary reports what the connection's state *is*
 * and lets the reader draw the conclusion. It does not assert a diagnosis the
 * Inspector cannot verify from its own side.
 */

import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client";

/** A request this client sent that no response has arrived for. */
export interface OutstandingRequest {
  id: string | number;
  method: string;
  /** Epoch ms at which the request went out. */
  sentAt: number;
}

/** The most recent response received to one of this client's requests. */
export interface LastResponse {
  /** The method of the request it answered. */
  method: string;
  /** Epoch ms at which it arrived. */
  receivedAt: number;
}

/**
 * The most recent long-lived server-to-client stream the transport opened —
 * the standalone `GET` on Streamable HTTP, or the primary event stream on
 * legacy SSE. Absent on stdio, and until the first such stream is opened.
 */
export interface NotificationStreamState {
  /** The request URL, as recorded (query already redacted). */
  url: string;
  /** Epoch ms at which the response headers arrived and the stream opened. */
  openedAt: number;
  /** SSE events delivered so far — messages, not keepalive comments. */
  eventCount: number;
  /** Epoch ms at which the stream ended, once it has. */
  closedAt?: number;
}

export interface ConnectionDiagnostics {
  /**
   * Epoch ms at which this snapshot was taken. Every duration derived from
   * the snapshot ("sent 60s ago", "open for 4m12s") is measured against this
   * clock rather than against the moment of rendering, so the snapshot is
   * self-contained: a message written from it, a component rendering it and
   * a test asserting on it all read the same numbers.
   */
  capturedAt: number;
  /**
   * Every request sent this session that has received no response, oldest
   * first. A request the SDK gave up on (a timeout, a cancel) stays here: it
   * is still unanswered, which is the fact being reported.
   */
  outstandingRequests: OutstandingRequest[];
  lastResponse?: LastResponse;
  notificationStream?: NotificationStreamState;
}

/**
 * The data the SDK attaches to a per-request timeout: `{ timeout }` in ms.
 * Narrowed here rather than imported because the SDK types it `unknown`.
 */
interface RequestTimeoutData {
  timeout: number;
}

function isRequestTimeoutData(value: unknown): value is RequestTimeoutData {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { timeout?: unknown }).timeout === "number"
  );
}

/**
 * Whether `err` is the SDK's per-request timeout: an `SdkError` with
 * `RequestTimeout` and a numeric `timeout` in its data.
 *
 * The data check is not decoration. `Protocol.request` reuses the
 * `RequestTimeout` code for two other rejections that are not timeouts at
 * all — an abort through `options.signal` whose reason is not an `SdkError`
 * (the Cancel button), and "Maximum total timeout exceeded" — and neither
 * carries `{ timeout }`. Only the genuine per-request timeout does.
 */
export function isRequestTimeoutError(
  err: unknown,
): err is SdkError & { data: RequestTimeoutData } {
  return (
    SdkError.isInstance(err) &&
    err.code === SdkErrorCode.RequestTimeout &&
    isRequestTimeoutData(err.data)
  );
}

/**
 * The reason a request's send failed, as the Protocol log shows it (#2721).
 *
 * A server that refuses a request at the HTTP layer — a bare `403` with no
 * `WWW-Authenticate` — never sends a JSON-RPC response, so the log has no
 * frame to show; this text is the entry's only record of how it ended. The
 * HTTP status is the fact a reader needs first, so it leads whenever the
 * error carries one (the SDK's `SdkHttpError`, or the remote transport's own
 * `Remote send failed` error) and the message does not already state it.
 */
export function describeSendFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const status = httpStatusOf(err);
  if (status === undefined || message.includes(`HTTP ${status}`)) {
    return message;
  }
  const statusText = httpStatusTextOf(err);
  return `HTTP ${status}${statusText ? ` ${statusText}` : ""}: ${message}`;
}

function httpStatusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null || !("status" in err)) {
    return undefined;
  }
  return typeof err.status === "number" ? err.status : undefined;
}

function httpStatusTextOf(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("statusText" in err)) {
    return undefined;
  }
  return typeof err.statusText === "string" ? err.statusText : undefined;
}

/**
 * A compact human duration: `850ms`, `12s`, `4m12s`, `1h02m`. Sub-second
 * values are shown in ms so a very short timeout still reads as a number
 * rather than as `0s`.
 */
export function formatDuration(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 1000) return `${Math.round(clamped)}ms`;
  const totalSeconds = Math.round(clamped / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/**
 * How many outstanding requests the summary names individually before
 * collapsing the rest into "and N more". Enough to show the shape of a stall
 * (the one everything is queued behind, plus what queued behind it) without
 * turning a toast into a page.
 */
export const MAX_LISTED_OUTSTANDING_REQUESTS = 5;

/**
 * `GET /mcp` for a stream URL: method plus path only. The origin is the
 * server the user is already connected to, and the query string (already
 * redacted at tracking time) adds nothing to a one-line summary. Falls back to
 * the raw string for an unparseable URL rather than dropping the clause.
 */
export function describeStreamEndpoint(url: string): string {
  try {
    return `GET ${new URL(url).pathname}`;
  } catch {
    return `GET ${url}`;
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function describeOutstanding(
  requests: OutstandingRequest[],
  now: number,
): string {
  if (requests.length === 0) return "No requests are unanswered.";
  const listed = requests
    .slice(0, MAX_LISTED_OUTSTANDING_REQUESTS)
    .map((r) => `${r.method} (sent ${formatDuration(now - r.sentAt)} ago)`);
  const rest = requests.length - listed.length;
  const tail = rest > 0 ? `, and ${rest} more` : "";
  const verb = requests.length === 1 ? "is" : "are";
  return `${plural(requests.length, "request")} ${verb} unanswered: ${listed.join(", ")}${tail}.`;
}

function describeLastResponse(
  lastResponse: LastResponse | undefined,
  now: number,
): string {
  if (!lastResponse) return "No response has been received this session.";
  return `Last response received ${formatDuration(now - lastResponse.receivedAt)} ago (${lastResponse.method}).`;
}

function describeStream(
  stream: NotificationStreamState | undefined,
  now: number,
): string | undefined {
  if (!stream) return undefined;
  const endpoint = describeStreamEndpoint(stream.url);
  const events = plural(stream.eventCount, "event");
  if (stream.closedAt !== undefined) {
    return `Notification stream (${endpoint}) closed ${formatDuration(now - stream.closedAt)} ago after ${formatDuration(stream.closedAt - stream.openedAt)}, ${events} delivered.`;
  }
  return `Notification stream (${endpoint}) open for ${formatDuration(now - stream.openedAt)}, ${events} delivered.`;
}

/**
 * One paragraph describing the connection's state as of the snapshot's own
 * clock: outstanding requests, the last response, and the notification
 * stream when there is one. Each clause is a sentence, so a consumer that
 * wants only one of them can split on the sentence boundary rather than
 * re-deriving it.
 */
export function describeConnectionDiagnostics(
  diagnostics: ConnectionDiagnostics,
): string {
  const now = diagnostics.capturedAt;
  const parts = [
    describeOutstanding(diagnostics.outstandingRequests, now),
    describeLastResponse(diagnostics.lastResponse, now),
    describeStream(diagnostics.notificationStream, now),
  ];
  return parts.filter((p): p is string => p !== undefined).join(" ");
}

/**
 * The data carried by an annotated timeout: the SDK's own `{ timeout }`, plus
 * the method that timed out and the snapshot the message was written from.
 * Exposed as a type so a consumer that wants the structured form (a details
 * modal, a CLI's JSON output) can read it off `error.data` instead of parsing
 * the message.
 */
export interface AnnotatedRequestTimeoutData extends RequestTimeoutData {
  method: string;
  diagnostics: ConnectionDiagnostics;
}

/**
 * Rebuild the SDK's per-request timeout with a message that says which
 * request timed out and what the connection looked like at that moment.
 *
 * Anything that is not that exact error is returned untouched — the SDK's
 * other `RequestTimeout` rejections (see {@link isRequestTimeoutError}), and
 * every other failure — so this is safe to apply blindly on the rejection
 * path of every request.
 *
 * The result is a fresh `SdkError` with the same code, so an `isInstance` or
 * code check downstream sees exactly what it saw before; only the message and
 * the data change. The original is kept as `cause`.
 */
export function annotateRequestTimeout(
  err: unknown,
  method: string,
  diagnostics: ConnectionDiagnostics,
): unknown {
  if (!isRequestTimeoutError(err)) return err;
  const data: AnnotatedRequestTimeoutData = {
    ...err.data,
    method,
    diagnostics,
  };
  const message = `Request timed out after ${formatDuration(err.data.timeout)} (${method}). ${describeConnectionDiagnostics(diagnostics)}`;
  const annotated = new SdkError(SdkErrorCode.RequestTimeout, message, data);
  annotated.cause = err;
  return annotated;
}
