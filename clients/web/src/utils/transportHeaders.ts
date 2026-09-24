import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";

// Custom headers are baked into an HTTP transport when it is created, so an
// edit made while connected only reaches the server after a reconnect (#2460).
// These helpers answer "would the next connect send different headers than the
// open one does?", so the UI can say so instead of leaving the user to find
// out from a server that rejects the request.

type HeaderSettings = Pick<InspectorServerSettings, "headers"> | undefined;

/**
 * The record the transport is handed, built exactly as `headersFromSettings`
 * in `core/mcp/node/transport.ts` builds it: rows with a blank key are
 * skipped, names are kept as typed (so `X-Tenant` and `x-tenant` are two
 * entries), and a later row for the identical name wins.
 */
export function transportHeaderRecord(
  settings: HeaderSettings,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of settings?.headers ?? []) {
    if (key.trim() === "") continue;
    out[key] = value;
  }
  return out;
}

// HTTP whitespace, which the Fetch spec strips from both ends of a value.
const HTTP_WHITESPACE = /^[\t\n\r ]+|[\t\n\r ]+$/g;

/**
 * The header set a settings object puts on the wire, as sorted `name: value`
 * lines. The SDK hands the record to `Headers` in the Node backend, which per
 * the Fetch spec lowercases names, strips surrounding whitespace from values
 * and joins case-variant duplicates with `", "` in insertion order. That is
 * restated here rather than delegated to the runtime's `Headers`: the browser
 * is not where the transport runs, and a non-conforming implementation (the
 * test DOM's does neither the join nor the trim) would disagree with the wire.
 */
export function wireHeaderLines(settings: HeaderSettings): string[] {
  const joined = new Map<string, string>();
  for (const [name, raw] of Object.entries(transportHeaderRecord(settings))) {
    const key = name.toLowerCase();
    const value = raw.replace(HTTP_WHITESPACE, "");
    const prior = joined.get(key);
    joined.set(key, prior === undefined ? value : `${prior}, ${value}`);
  }
  return [...joined].map(([name, value]) => `${name}: ${value}`).sort();
}

/**
 * Whether `next` would send a different custom-header set than `sent`. Row
 * order, blank rows, header-name case and surrounding whitespace in a value
 * are not differences the server can see, so none of them count.
 */
export function customHeadersChanged(
  sent: HeaderSettings,
  next: HeaderSettings,
): boolean {
  const a = wireHeaderLines(sent);
  const b = wireHeaderLines(next);
  return a.length !== b.length || a.some((line, i) => line !== b[i]);
}
