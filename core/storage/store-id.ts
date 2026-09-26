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
 * `__proto__` matches the character class but is additionally rejected: a
 * plain `map[id] = …` assignment with it invokes the inherited prototype
 * setter and silently drops the entry. Other `Object.prototype` names
 * (`constructor`, `toString`, …) stay valid — they were accepted before this
 * check existed, so rejecting them would strand pre-existing `mcp.json`
 * entries (listed by GET but refused by PUT/DELETE), and they are safe
 * because every dynamic-key map access uses own-property operations
 * (`Object.hasOwn`, `getOwnEntry`/`setOwnEntry`), never `in` membership or
 * bare reads.
 */
export function validateStoreId(storeId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(storeId) && storeId !== "__proto__";
}
