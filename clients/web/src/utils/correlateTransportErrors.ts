import type {
  MessageEntry,
  FetchRequestEntry,
} from "@inspector/core/mcp/types.js";
import type { JSONRPCErrorResponse } from "@modelcontextprotocol/client";
import { parseJsonRpcError } from "./mcpNetworkHeaders";

/**
 * Correlation between the Protocol log (`MessageEntry`) and the Network log
 * (`FetchRequestEntry`). The two logs share no key, but a transport fetch's
 * `requestBody` is the serialized JSON-RPC message, so its `id` matches the
 * Protocol request's `message.id`. This lets the Protocol view (a) surface the
 * transport errors the SDK *throws* rather than delivers (e.g. `-32601`, which
 * comes back as HTTP 404) and (b) link a Protocol error to its HTTP entry.
 */

/** The JSON-RPC `id` from a request/response body string, or null. */
function parseJsonRpcId(body: string | undefined): string | number | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "id" in parsed
    ) {
      const id = (parsed as { id: unknown }).id;
      if (typeof id === "string" || typeof id === "number") return id;
    }
  } catch {
    /* not JSON — no id */
  }
  return null;
}

/** The JSON-RPC `id` a MessageEntry carries (request id; notifications have none). */
export function messageJsonRpcId(
  entry: MessageEntry,
): string | number | undefined {
  // Requests / results / errors carry an `id`; a notification does not. When
  // present it is a well-typed `RequestId` (string | number).
  const msg = entry.message;
  return "id" in msg ? msg.id : undefined;
}

/**
 * Index the transport fetch entries that carry a JSON-RPC *error* response body,
 * keyed by the JSON-RPC id of the request that produced them. When ids repeat
 * (retries / reconnects), the last (most recent) wins.
 */
function indexTransportFetchErrors(
  fetchEntries: FetchRequestEntry[],
): Map<string, JSONRPCErrorResponse> {
  const byId = new Map<string, JSONRPCErrorResponse>();
  for (const fetchEntry of fetchEntries) {
    if (fetchEntry.category !== "transport") continue;
    const requestId = parseJsonRpcId(fetchEntry.requestBody);
    if (requestId === null) continue;
    const error = parseJsonRpcError(fetchEntry.responseBody);
    if (!error) continue;
    byId.set(String(requestId), {
      jsonrpc: "2.0",
      id: requestId,
      error: {
        code: error.code,
        message: error.message,
        ...(error.data !== undefined ? { data: error.data } : {}),
      },
    });
  }
  return byId;
}

/**
 * The transport `FetchRequestEntry` whose request carried the same JSON-RPC id
 * as `entry` — the HTTP entry to reveal when the user clicks through from a
 * Protocol error. Returns the most recent match, or undefined.
 */
export function correlateFetchEntry(
  entry: MessageEntry,
  fetchEntries: FetchRequestEntry[],
): FetchRequestEntry | undefined {
  const targetId = messageJsonRpcId(entry);
  if (targetId === undefined) return undefined;
  let match: FetchRequestEntry | undefined;
  for (const fetchEntry of fetchEntries) {
    if (fetchEntry.category !== "transport") continue;
    const requestId = parseJsonRpcId(fetchEntry.requestBody);
    if (requestId !== null && String(requestId) === String(targetId)) {
      match = fetchEntry;
    }
  }
  return match;
}

/**
 * The set of Protocol `MessageEntry` ids that have a correlated transport fetch.
 * This is a **superset** of the entries that actually show a "reveal in Network"
 * link — it includes any correlated message (even a successful `tools/call`), not
 * just spec errors. The narrowing gate is applied downstream at render:
 * `ProtocolListPanel` only wires `onRevealInNetwork` for ids in this set, and
 * `ProtocolEntry` only renders the anchor when the entry's spec error is
 * `httpRelevant` — so a non-error correlated message never produces a stray link.
 * Indexes the fetch log once by JSON-RPC id, so this is O(messages + fetches).
 */
export function revealableMessageIds(
  messages: MessageEntry[],
  fetchEntries: FetchRequestEntry[],
): Set<string> {
  const fetchIdByRequestId = new Set<string>();
  for (const fetchEntry of fetchEntries) {
    if (fetchEntry.category !== "transport") continue;
    const requestId = parseJsonRpcId(fetchEntry.requestBody);
    if (requestId !== null) fetchIdByRequestId.add(String(requestId));
  }
  const ids = new Set<string>();
  for (const entry of messages) {
    const id = messageJsonRpcId(entry);
    if (id !== undefined && fetchIdByRequestId.has(String(id)))
      ids.add(entry.id);
  }
  return ids;
}

/**
 * Fold a synthetic error `response` into any still-pending request whose
 * correlated transport fetch carried a JSON-RPC error. This surfaces the errors
 * the SDK throws instead of delivering (notably `-32601` on HTTP 404) into the
 * Protocol view, without mutating the underlying log — the returned list is a
 * shallow copy that only differs for the enriched entries (same object when
 * nothing matched, so referential equality is preserved for memoisation).
 */
export function enrichProtocolEntries(
  messages: MessageEntry[],
  fetchEntries: FetchRequestEntry[],
): MessageEntry[] {
  const errorsById = indexTransportFetchErrors(fetchEntries);
  if (errorsById.size === 0) return messages;
  let changed = false;
  const enriched = messages.map((entry) => {
    if (entry.direction !== "request" || entry.response) return entry;
    const id = messageJsonRpcId(entry);
    if (id === undefined) return entry;
    const error = errorsById.get(String(id));
    if (!error) return entry;
    changed = true;
    return { ...entry, response: error };
  });
  return changed ? enriched : messages;
}
