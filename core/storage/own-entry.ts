/**
 * Assign a dynamic key as an *own* data property.
 *
 * Plain `map[key] = value` invokes inherited accessors: with
 * `key === "__proto__"` it calls `Object.prototype`'s setter instead of
 * creating an entry, so the value silently vanishes from the map — a write
 * that reports success and then serializes nothing. In the OAuth
 * persistence maps the keys are attacker-influenceable server URLs and
 * issuer strings, so every dynamic-key write into a plain-object map must
 * go through this helper (reads and `Object.entries`/spread copies are safe
 * — JSON.parse and spread both produce own properties).
 *
 * Node-free and pure, like `store-id.ts`, so isomorphic code can use it.
 */
export function setOwnEntry<T>(
  map: Record<string, T>,
  key: string,
  value: T,
): void {
  Object.defineProperty(map, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
