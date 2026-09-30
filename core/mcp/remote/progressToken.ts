/**
 * Shared helper for the remote relay's progress-aware request-response waits
 * (#2028). Pure and browser-safe, so both the browser `RemoteClientTransport`
 * and the Node `RemoteSession` import it rather than each carrying a copy.
 */

import { ProgressTokenSchema } from "@modelcontextprotocol/core";
import type { JSONRPCMessage } from "@modelcontextprotocol/client";

/**
 * The token identifying the request a `notifications/progress` belongs to, or
 * `undefined` for any other message. The SDK stamps `progressToken: messageId`
 * on the outbound request, so a progress notification's `progressToken` is the
 * id of the request whose wait should be re-armed.
 *
 * Validation is delegated to the SDK's own `ProgressTokenSchema` rather than a
 * hand-rolled `typeof` check — the protocol allows only a string or a *safe*
 * integer, and zod's `.int()` rejects a fractional or past-`MAX_SAFE_INTEGER`
 * value that a bare `typeof token === "number"` would wave through (the same
 * drift `isProgressToken` in `core/mcp/inspectorClient.ts` exists to avoid).
 */
export function progressTokenOf(
  message: JSONRPCMessage,
): string | number | undefined {
  if (
    "method" in message &&
    message.method === "notifications/progress" &&
    "params" in message &&
    typeof message.params === "object" &&
    message.params !== null
  ) {
    const parsed = ProgressTokenSchema.safeParse(
      (message.params as { progressToken?: unknown }).progressToken,
    );
    if (parsed.success) {
      return parsed.data;
    }
  }
  return undefined;
}

/**
 * The pending wait a progress token belongs to, looked up in a map keyed by
 * request id. An exact match wins; failing that, a string token is coerced
 * with `Number()` and retried (#2458). The SDK stamps the request's numeric id
 * as the token, but a server may echo it back as a string (`"4"`), and the
 * SDK's own `Protocol` correlates progress with `Number(progressToken)` — so
 * matching only the exact key silently lets the relay's flat 60s deadline fire
 * while a direct transport keeps the call alive.
 */
export function waitForProgressToken<T>(
  waits: ReadonlyMap<string | number, T>,
  token: string | number,
): T | undefined {
  const exact = waits.get(token);
  if (exact !== undefined || typeof token === "number") {
    return exact;
  }
  const numeric = Number(token);
  return Number.isSafeInteger(numeric) ? waits.get(numeric) : undefined;
}
