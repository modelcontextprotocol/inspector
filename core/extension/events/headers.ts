/**
 * Streamable HTTP routing headers for `events/*` requests (SEP-3415, "Streamable
 * HTTP: Routing Headers"; SEP-2243).
 *
 * The spec applies the transport's tool rules unchanged, "with the event type in
 * place of the tool definition, `events/list` in place of `tools/list`", so this
 * reuses the `x-mcp-header` scanner and header builder in `core/json/xMcpHeader.ts`
 * rather than a second copy:
 *
 * - An event type whose `inputSchema` annotations violate the transport's
 *   constraints is **excluded** from `events/list`, with a warning
 *   ({@link partitionEventTypesByHeaderValidity}).
 * - `events/poll`, `events/stream`, `events/subscribe` and `events/unsubscribe`
 *   carry an `Mcp-Param-{Name}` header per annotated argument
 *   ({@link mcpParamHeadersForEvent}) and an `Mcp-Name` header equal to
 *   `params.name` ({@link createEventsMcpNameFetch}).
 *
 * **Why `Mcp-Name` is a fetch wrapper and `Mcp-Param-*` is not.** Verified
 * against `@modelcontextprotocol/client` 2.4.0's dist rather than assumed: the
 * Streamable HTTP transport derives `Mcp-Name` from a fixed table
 * (`MCP_NAME_HEADER_SOURCE`: `tools/call`, `prompts/get`, `resources/read`,
 * `tasks/*`), so an `events/*` request goes out without one. And `mcp-name` is in
 * its `RESERVED_REQUEST_HEADER_NAMES`, so the per-request `headers` option
 * silently drops it. `Mcp-Param-*` is not reserved: it travels on the per-request
 * `headers` option exactly as the tools path sends it, which also crosses the web
 * client's remote relay (it forwards the `Mcp-Param-` prefix). `Mcp-Name` has to
 * be set below the transport, on the fetch it is given.
 */

import { PROTOCOL_VERSION_META_KEY } from "@modelcontextprotocol/client";
import {
  buildMcpParamHeaders,
  encodeMcpParamValue,
  scanXMcpHeaderDeclarations,
} from "../../json/xMcpHeader.js";
import { MODERN_PROTOCOL_VERSION } from "../../mcp/types.js";
import { EVENTS_NAMED_METHODS } from "./constants.js";
import type { EventType } from "./schemas.js";

/** An event type left out of `events/list` for invalid annotations. */
export interface ExcludedEventType {
  eventType: EventType;
  /** The first violated constraint, as the scanner words it. */
  reason: string;
}

/**
 * Split an `events/list` page into the event types a Streamable HTTP client may
 * keep and the ones it MUST exclude for invalid `x-mcp-header` annotations.
 * Order is preserved in both halves.
 */
export function partitionEventTypesByHeaderValidity(eventTypes: EventType[]): {
  kept: EventType[];
  excluded: ExcludedEventType[];
} {
  const kept: EventType[] = [];
  const excluded: ExcludedEventType[] = [];
  for (const eventType of eventTypes) {
    const scan = scanXMcpHeaderDeclarations(eventType.inputSchema);
    if (scan.valid) kept.push(eventType);
    else excluded.push({ eventType, reason: scan.reason });
  }
  return { kept, excluded };
}

/**
 * The `Mcp-Param-*` headers one `events/*` request must carry for `eventType`
 * and its `arguments`. `{}` when the type declares no `x-mcp-header`, when its
 * annotations are invalid (it would have been excluded), or when no annotated
 * argument has a value.
 */
export function mcpParamHeadersForEvent(
  eventType: EventType,
  args: Record<string, unknown> | undefined,
): Record<string, string> {
  const scan = scanXMcpHeaderDeclarations(eventType.inputSchema);
  if (!scan.valid || scan.declarations.length === 0) return {};
  return buildMcpParamHeaders(scan.declarations, args ?? {});
}

/**
 * Wrap fetch so a modern `events/*` request that names an event carries
 * `Mcp-Name: <params.name>` (spec, "Streamable HTTP: Routing Headers").
 *
 * Mirrors the SDK's own body-derived header rule so the two cannot disagree:
 * only a single JSON-RPC **request** whose `_meta` claims a modern protocol
 * version is touched, so a legacy exchange never gains a 2026 header. The name
 * is encoded with the transport's Base64 sentinel when it is not a safe plain
 * header value. A header the caller already set is left alone. Anything else
 * passes through untouched — a non-POST, a batch, a non-string body, a
 * notification, `events/list`, a method outside the extension.
 */
export function createEventsMcpNameFetch(
  baseFetch: typeof fetch,
): typeof fetch {
  return (input, init) => {
    const name = eventsRequestName(init);
    if (name === undefined) return baseFetch(input, init);
    const headers = new Headers(init?.headers);
    if (headers.has("mcp-name")) return baseFetch(input, init);
    headers.set("mcp-name", encodeMcpParamValue(name));
    return baseFetch(input, { ...init, headers });
  };
}

/**
 * `params.name` of a single modern `events/*` request that carries one, or
 * `undefined` for anything else.
 */
function eventsRequestName(init: RequestInit | undefined): string | undefined {
  if (init?.method?.toUpperCase() !== "POST") return undefined;
  if (typeof init.body !== "string") return undefined;
  let message: unknown;
  try {
    message = JSON.parse(init.body);
  } catch {
    return undefined;
  }
  if (!isRecord(message) || !("id" in message)) return undefined;
  if (typeof message.method !== "string") return undefined;
  if (!EVENTS_NAMED_METHODS.has(message.method)) return undefined;
  const params = isRecord(message.params) ? message.params : undefined;
  const meta = isRecord(params?._meta) ? params._meta : undefined;
  const version = meta?.[PROTOCOL_VERSION_META_KEY];
  // Dated revision tokens order lexically — the SDK's own era test.
  if (typeof version !== "string" || version < MODERN_PROTOCOL_VERSION) {
    return undefined;
  }
  return typeof params?.name === "string" ? params.name : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
