/**
 * Pure, Node-free store-id validation. Lives apart from `store-io.ts` (which
 * imports `node:fs`/`node:path`) so isomorphic code — e.g. the browser import
 * flow in `core/mcp/import` — can validate ids without pulling Node deps into
 * the browser bundle. `store-io.ts` re-exports this so existing importers are
 * unaffected.
 */

/**
 * A store id must be non-empty and contain only alphanumerics, hyphens, and
 * underscores (it becomes a filename and an `mcpServers` map key). Reject
 * every `Object.prototype` member name, not just `__proto__`: they all match
 * the character class, but as map keys they collide with the prototype chain
 * — `__proto__` assignment invokes the inherited setter and silently drops
 * the server, and any of them (`constructor`, `toString`, …) makes an
 * `id in map` membership check answer true on an empty map, so the id could
 * never be created (a permanent false "duplicate"). `in Object.prototype`
 * covers exactly that set.
 */
export function validateStoreId(storeId: string): boolean {
  return (
    /^[a-zA-Z0-9_-]+$/.test(storeId) &&
    storeId.length > 0 &&
    !(storeId in Object.prototype)
  );
}
