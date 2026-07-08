/**
 * Pure, Node-free JSON (de)serialization for store files. Split from
 * `store-io.ts` (which imports `node:fs`/`node:path`/`atomically`) so
 * isomorphic code — e.g. the browser OAuth persistence flow in
 * `core/auth/oauth-persist.ts` — can (de)serialize store blobs without
 * pulling Node deps into the browser bundle. `store-io.ts` re-exports these
 * so existing importers are unaffected.
 */

export function serializeStore(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function parseStore(raw: string): unknown {
  return JSON.parse(raw);
}
