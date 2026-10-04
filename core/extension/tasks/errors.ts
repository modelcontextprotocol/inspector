/**
 * Error identity across the ext-tasks boundary.
 *
 * ext-tasks applies its own failure policy to whatever the host's raw
 * dispatch throws: a transport or timeout failure comes back as a
 * `DispatchError` whose `cause` is the original, and a JSON-RPC or task
 * failure as `JsonRpcResponseError` / `TaskFailedError`. The Inspector's
 * callers — and the UI that renders their messages — expect the SDK's own
 * shapes (`ProtocolError`, an annotated `SdkError` timeout), so every task
 * operation restores them on the way out through these helpers.
 */
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/client";
import {
  DispatchError,
  JsonRpcResponseError,
  TaskFailedError,
} from "@modelcontextprotocol/ext-tasks/client";

/** The rejection for a signal that aborted: its own reason when that is an
 * Error, else a standard `AbortError`. */
export function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

/** Restore host/transport and protocol error identity after ext-tasks policy. */
export function unwrapTaskDispatchError(error: unknown): unknown {
  const unwrapped =
    error instanceof DispatchError && error.cause instanceof Error
      ? error.cause
      : error;
  if (unwrapped instanceof JsonRpcResponseError)
    return new ProtocolError(unwrapped.code, unwrapped.message, unwrapped.data);
  if (unwrapped instanceof TaskFailedError && unwrapped.code !== undefined)
    return new ProtocolError(unwrapped.code, unwrapped.message, unwrapped.data);
  return unwrapped;
}

/** Normalize any task failure to a `ProtocolError` for event payloads. */
export function toProtocolError(reason: unknown): ProtocolError {
  const normalized = unwrapTaskDispatchError(reason);
  return normalized instanceof ProtocolError
    ? normalized
    : new ProtocolError(
        ProtocolErrorCode.InternalError,
        normalized instanceof Error ? normalized.message : String(normalized),
      );
}
