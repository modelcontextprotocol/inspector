/**
 * The relay's view of requests that do not follow the "send, then wait a
 * bounded time for the answer" pattern (#3029). Pure and browser-safe, so the
 * browser `RemoteClientTransport` and the backend's `/api/mcp/send` route
 * classify a message the same way.
 *
 * The web relay waits for every request's JSON-RPC response twice — the
 * backend holds `/api/mcp/send` open until it arrives, and the browser waits
 * for it on the event channel — each with a 60 s budget that progress
 * notifications re-arm (#2028). Two kinds of request break that model:
 *
 * - **An unbounded stream.** An `events/stream` (SEP-3415) is answered only
 *   when the server ends the subscription, which may be never; its liveness
 *   signal is the heartbeat, which the subscription engine checks. Either
 *   relay wait firing first would tear down a healthy stream, so both waits
 *   are held with no timeout and end on the response, the browser's abort, or
 *   a cancellation.
 * - **A cancelled request.** A server SHOULD NOT answer a request cancelled
 *   with `notifications/cancelled` (the stdio cancellation, which the relay
 *   carries for every transport without a per-request stream). A wait for its
 *   answer would otherwise run to its timeout — and for an unbounded stream,
 *   forever — so the cancellation releases it.
 */

import type { JSONRPCMessage } from "@modelcontextprotocol/client";
import { EVENTS_STREAM_METHOD } from "../../extension/events/constants.js";

/** Whether the relay must wait for this request's answer with no timeout. */
export function isUnboundedStreamRequest(message: JSONRPCMessage): boolean {
  return (
    "method" in message &&
    "id" in message &&
    message.method === EVENTS_STREAM_METHOD
  );
}

/**
 * The id a `notifications/cancelled` cancels, or `undefined` when `message`
 * is not one (or names no usable id).
 */
export function cancelledRequestIdOf(
  message: JSONRPCMessage,
): string | number | undefined {
  if (!("method" in message) || message.method !== "notifications/cancelled") {
    return undefined;
  }
  if ("id" in message) return undefined;
  const requestId = (message.params as { requestId?: unknown } | undefined)
    ?.requestId;
  return typeof requestId === "string" || typeof requestId === "number"
    ? requestId
    : undefined;
}
