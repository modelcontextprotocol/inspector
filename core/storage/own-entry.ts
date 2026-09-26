/**
 * Assign a dynamic key as an *own* data property.
 *
 * Plain `map[key] = value` invokes inherited accessors: with
 * `key === "__proto__"` it calls `Object.prototype`'s setter instead of
 * creating an entry, so the value silently vanishes from the map — a write
 * that reports success and then serializes nothing. In the OAuth
 * persistence maps the keys are attacker-influenceable server URLs and
 * issuer strings, so every dynamic-key write into a plain-object map must
 * go through this helper ({@link getOwnEntry} is the read-side counterpart;
 * `Object.entries`/spread copies are safe — JSON.parse and spread both
 * produce own properties).
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

/**
 * Read a dynamic key as an *own* data property.
 *
 * The read-side counterpart of {@link setOwnEntry}: `map[key]` consults the
 * prototype chain, so with `key === "__proto__"` (or `"constructor"`,
 * `"toString"`, …) a *missing* entry reads as the inherited
 * `Object.prototype` member instead of `undefined`. Downstream that turns a
 * deletion into an update (the "absent means delete" checks see a truthy
 * value) and hands callers `Object.prototype` masquerading as an entry.
 * Every dynamic-key read keyed by an untrusted name must go through this
 * helper; `Object.entries`/spread iteration is safe (own properties only).
 */
export function getOwnEntry<T>(
  map: Record<string, T> | undefined,
  key: string,
): T | undefined {
  return map !== undefined && Object.hasOwn(map, key) ? map[key] : undefined;
}
