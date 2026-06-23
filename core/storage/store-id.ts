/**
 * Pure, Node-free store-id validation. Lives apart from `store-io.ts` (which
 * imports `node:fs`/`node:path`) so isomorphic code — e.g. the browser import
 * flow in `core/mcp/import` — can validate ids without pulling Node deps into
 * the browser bundle. `store-io.ts` re-exports this so existing importers are
 * unaffected.
 */

/**
 * A store id must be non-empty and contain only alphanumerics, hyphens, and
 * underscores (it becomes a filename and an `mcpServers` map key).
 */
export function validateStoreId(storeId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(storeId) && storeId.length > 0;
}
