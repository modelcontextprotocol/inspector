import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";

// Custom headers are baked into an HTTP transport when it is created, so an
// edit made while connected only reaches the server after a reconnect (#2460).
// These helpers answer "would the next connect send different headers than the
// open one does?", so the UI can say so instead of leaving the user to find
// out from a server that rejects the request.

/**
 * The header set a settings object puts on the wire, resolved the way the
 * transport resolves it: rows with a blank key are skipped (as
 * `headersFromSettings` in `core/mcp/node/transport.ts` does), a later row for
 * the same name wins, and names compare case-insensitively (as `Headers` does).
 */
export function effectiveCustomHeaders(
  settings: Pick<InspectorServerSettings, "headers"> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of settings?.headers ?? []) {
    if (key.trim() === "") continue;
    out[key.toLowerCase()] = value;
  }
  return out;
}

/**
 * Whether `next` would send a different custom-header set than `sent`. Row
 * order, blank rows and header-name case are not differences the server can
 * see, so none of them count.
 */
export function customHeadersChanged(
  sent: Pick<InspectorServerSettings, "headers"> | undefined,
  next: Pick<InspectorServerSettings, "headers"> | undefined,
): boolean {
  const a = effectiveCustomHeaders(sent);
  const b = effectiveCustomHeaders(next);
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return true;
  return keys.some((key) => !(key in b) || a[key] !== b[key]);
}
