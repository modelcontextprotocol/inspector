/**
 * How the subscription engine reads an Events error (SEP-3415, #3029): which
 * ones end a subscription, and what the client does next when one does.
 *
 * Two sources carry the same nested `{code, message, data}` shape: the
 * `error` of a `notifications/events/{error,terminated}`, and a JSON-RPC error
 * answering an `events/poll` or `events/stream` request (which the SDK raises
 * as a `ProtocolError` with a numeric `code`). Everything else a request can
 * reject with — a dropped connection, an abort, a local timeout — has a
 * string code or none, and is a transport failure to retry, not a verdict.
 */

import { EVENTS_ERROR_CODES } from "./constants.js";

/** The nested error every Events failure carries. */
export interface EventsErrorInfo {
  code: number;
  message: string;
  data?: unknown;
}

/** JSON-RPC `InvalidParams`, `MethodNotFound`, and SEP-2243 `HeaderMismatch`. */
const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;
export const HEADER_MISMATCH_CODE = -32020;

/**
 * The codes a server answers an `events/poll` or `events/stream` with when the
 * subscription itself is invalid (spec: "the server responds immediately with
 * a JSON-RPC error and no stream is opened"). Retrying the same request cannot
 * succeed, so the engine ends the subscription instead of looping on it.
 * `MethodNotFound` is here too: a server that answers it does not offer the
 * method at all.
 */
const TERMINAL_REQUEST_CODES: ReadonlySet<number> = new Set([
  INVALID_PARAMS,
  METHOD_NOT_FOUND,
  HEADER_MISMATCH_CODE,
  EVENTS_ERROR_CODES.NotFound,
  EVENTS_ERROR_CODES.Forbidden,
  EVENTS_ERROR_CODES.ResourceExhausted,
  EVENTS_ERROR_CODES.Unsupported,
  EVENTS_ERROR_CODES.CallbackEndpointError,
]);

/**
 * The JSON-RPC error a rejected request carried, or `undefined` when the
 * rejection was not a JSON-RPC error response (a transport failure, an abort,
 * a timeout). Read structurally: the SDK's `ProtocolError` is the usual
 * carrier, but anything with a numeric `code` and a `message` is one.
 */
export function eventsErrorOf(err: unknown): EventsErrorInfo | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const { code, message, data } = err as {
    code?: unknown;
    message?: unknown;
    data?: unknown;
  };
  if (typeof code !== "number" || typeof message !== "string") {
    return undefined;
  }
  return { code, message, ...(data !== undefined && { data }) };
}

/** Whether a request answered with `code` can never succeed as sent. */
export function isTerminalRequestError(code: number): boolean {
  return TERMINAL_REQUEST_CODES.has(code);
}

/**
 * Why a subscription ended, as the client acts on it:
 *
 * - `removed` — `NotFound`: the event type is gone (spec, Event type removal).
 * - `schema_changed` — `Unsupported` with `data.reason: "schema_changed"`: the
 *   type changed incompatibly in place.
 * - `header_mismatch` — `HeaderMismatch`: the client's `Mcp-Param-*` headers
 *   no longer match the server's `inputSchema`.
 * - `forbidden` — `Forbidden`: the principal's access was refused or revoked.
 * - `rejected` — anything else (`InvalidParams`, `ResourceExhausted`, an
 *   unsupported option, an unknown code on a `terminated`).
 */
export type EventsTerminationReason =
  | "removed"
  | "schema_changed"
  | "header_mismatch"
  | "forbidden"
  | "rejected";

export interface EventsTerminationOutcome {
  reason: EventsTerminationReason;
  /**
   * Whether the client fetches `events/list` again and offers to resubscribe
   * against the current descriptor. True for the three reasons that mean "the
   * contract changed", never for `forbidden`: the spec says the first two are
   * explicitly not an authorization failure, and the transport tells a client
   * that gets `HeaderMismatch` to re-list and retry.
   */
  relist: boolean;
}

function dataReason(data: unknown): unknown {
  if (data === null || typeof data !== "object") return undefined;
  return (data as { reason?: unknown }).reason;
}

/** Classify the error that ended a subscription. */
export function classifyTermination(
  error: EventsErrorInfo,
): EventsTerminationOutcome {
  switch (error.code) {
    case EVENTS_ERROR_CODES.NotFound:
      return { reason: "removed", relist: true };
    case EVENTS_ERROR_CODES.Unsupported:
      return dataReason(error.data) === "schema_changed"
        ? { reason: "schema_changed", relist: true }
        : { reason: "rejected", relist: false };
    case HEADER_MISMATCH_CODE:
      return { reason: "header_mismatch", relist: true };
    case EVENTS_ERROR_CODES.Forbidden:
      return { reason: "forbidden", relist: false };
    default:
      return { reason: "rejected", relist: false };
  }
}

/** A failure that is not a JSON-RPC error, as an `EventsErrorInfo`. */
export function transportErrorInfo(err: unknown): EventsErrorInfo {
  // -32603 (InternalError) is the closest JSON-RPC code; the message is what
  // the user reads, and `data.transport` marks it as raised locally.
  return {
    code: -32603,
    message: err instanceof Error ? err.message : String(err),
    data: { transport: true },
  };
}
