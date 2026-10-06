import type { MessageEntry, MessageMethod } from "@inspector/core/mcp/types.js";
import {
  isInputRequiredResult,
  SUBSCRIPTION_ID_META_KEY,
} from "@modelcontextprotocol/client";

export function extractMethod(entry: MessageEntry): MessageMethod {
  if ("method" in entry.message) {
    // Cast: SDK types message.method as `string`, but every entry in this
    // app's MessageEntry log originates from MCP SDK schemas.
    return entry.message.method as MessageMethod;
  }
  return "response";
}

// --- Modern-era (2026-07-28) message vocabulary -----------------------------
//
// The modern era changes the over-the-wire conversation (spec §7.2–7.4): every
// result carries a `resultType`, server→client interactions become MRTR (the
// server *returns* `input_required` and the client *retries* with a new id),
// and push notifications move to a `subscriptions/listen` stream. These helpers
// read that vocabulary off the transport-level `MessageEntry` log so the
// Protocol view can render and correlate it. IMPORTANT: they classify individual
// *frames* — they must NOT be used to decide a connection's era. The modern
// probe carries the `_meta` envelope before the era is negotiated, so "saw an
// envelope/resultType" ≠ "modern negotiated" (spec §8.3). Era labeling comes
// from the negotiated `protocolEra` connection state, threaded in as a prop.

// The successful `result` object of a request entry's paired response, or
// undefined when there is no response or it was an error. (messageLogState folds
// a request's response onto the request entry by JSON-RPC id.)
function getResponseResult(
  entry: MessageEntry,
): Record<string, unknown> | undefined {
  const response = entry.response;
  if (!response || "error" in response) return undefined;
  const result = response.result;
  return result && typeof result === "object"
    ? (result as Record<string, unknown>)
    : undefined;
}

function getMessageParams(
  entry: MessageEntry,
): Record<string, unknown> | undefined {
  const msg = entry.message;
  if (!("params" in msg) || !msg.params) return undefined;
  return msg.params as Record<string, unknown>;
}

/**
 * The modern `resultType` discriminator on a request's paired result:
 * `"input_required"` (the server needs input before it can complete) or
 * `"complete"`. Undefined for legacy results (no `resultType` on the wire),
 * errors, notifications, and pending requests — so a `resultType` badge only
 * shows where the modern era actually put one.
 */
export function extractResultType(
  entry: MessageEntry,
): "complete" | "input_required" | undefined {
  const result = getResponseResult(entry);
  if (!result) return undefined;
  if (isInputRequiredResult(result)) return "input_required";
  return result.resultType === "complete" ? "complete" : undefined;
}

// A non-empty `requestState` string, or undefined.
function asRequestState(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// The `requestState` a round's `input_required` result *issued* to the client.
function issuedRequestState(entry: MessageEntry): string | undefined {
  return asRequestState(getResponseResult(entry)?.requestState);
}

// The `requestState` a retried round *echoed* back in its params.
function echoedRequestState(entry: MessageEntry): string | undefined {
  return asRequestState(getMessageParams(entry)?.requestState);
}

/**
 * The opaque MRTR `requestState` token that links the rounds of one logical
 * operation across multiple JSON-RPC ids. It appears on the `input_required`
 * *result* (original call) and is echoed back in the *params* of the retried
 * request (spec §7.3). Returns undefined for non-MRTR traffic.
 */
export function extractRequestState(entry: MessageEntry): string | undefined {
  return issuedRequestState(entry) ?? echoedRequestState(entry);
}

/**
 * The `subscriptionId` a modern push notification is tagged with, carried in
 * `params._meta` under `io.modelcontextprotocol/subscriptionId` (spec §7.4).
 * Undefined for untagged frames.
 */
export function extractSubscriptionId(entry: MessageEntry): string | undefined {
  const params = getMessageParams(entry);
  const meta = params?._meta as Record<string, unknown> | undefined;
  const id = meta?.[SUBSCRIPTION_ID_META_KEY];
  return typeof id === "string" ? id : undefined;
}

/**
 * A rendered row in the Protocol list: either a single message entry, or an
 * MRTR conversation — the contiguous run of entries linked by `requestState`
 * (original call → `input_required` → retried call → final result), grouped so
 * one logical operation renders as one expandable unit.
 */
export type ProtocolRow =
  | { kind: "single"; entry: MessageEntry }
  | { kind: "mrtr"; requestState: string; rounds: MessageEntry[] };

// Whether `later` is the next round of `earlier`'s conversation: it echoes the
// token `earlier`'s result issued. The token is opaque, so a server is free to
// mint a fresh one each round (#2608) — rounds are linked by this hand-off, not
// by one shared key. Two retries echoing the same token (a round whose result
// was an error, retried) are siblings of one conversation too.
function continuesConversation(
  earlier: MessageEntry,
  later: MessageEntry,
): boolean {
  const echoed = echoedRequestState(later);
  if (echoed === undefined) return false;
  return (
    echoed === issuedRequestState(earlier) ||
    echoed === echoedRequestState(earlier)
  );
}

// The token a conversation is named by: the one its chronologically first
// round received (a lone retry) or else issued (the original call).
function conversationRequestState(first: MessageEntry): string | undefined {
  return echoedRequestState(first) ?? issuedRequestState(first);
}

/**
 * Fold a (already filtered/sorted) entry list into rows, clustering contiguous
 * MRTR rounds into one MRTR row. Each round joins the row before it when the
 * two hand a `requestState` from one to the other (see
 * `continuesConversation`), checked in both directions because the list may
 * be sorted newest-first. Contiguity is safe because the SDK auto-fulfils MRTR
 * input in-process (no intervening wire frames) so an operation's rounds are
 * adjacent in the log. Order is preserved; everything without a
 * `requestState` stays a `single` row.
 */
export function groupProtocolEntries(entries: MessageEntry[]): ProtocolRow[] {
  const rows: ProtocolRow[] = [];
  for (const entry of entries) {
    const requestState = conversationRequestState(entry);
    if (requestState) {
      const last = rows[rows.length - 1];
      if (last?.kind === "mrtr") {
        const neighbour = last.rounds[last.rounds.length - 1];
        if (continuesConversation(neighbour, entry)) {
          last.rounds.push(entry);
          continue;
        }
        // Newest-first: this entry is the earlier round, so the conversation
        // is now named by its token.
        if (continuesConversation(entry, neighbour)) {
          last.rounds.push(entry);
          last.requestState = requestState;
          continue;
        }
      }
      rows.push({ kind: "mrtr", requestState, rounds: [entry] });
      continue;
    }
    rows.push({ kind: "single", entry });
  }
  return rows;
}
