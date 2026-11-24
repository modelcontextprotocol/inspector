/**
 * Canonical JSON for subscription identity (SEP-3415, #3029).
 *
 * The spec compares a subscription's `arguments` "by canonical-JSON equality"
 * (Subscription identity), and the client-owned registry is keyed the same way:
 * `{a: 1, b: 2}` and `{b: 2, a: 1}` are one subscription, not two. Plain
 * `JSON.stringify` keeps insertion order, so it would key them apart.
 *
 * This is the narrow canonical form that question needs — object keys sorted
 * at every depth, everything else exactly as `JSON.stringify` writes it
 * (`undefined` members dropped, array order kept). It is not RFC 8785: number
 * formatting is the engine's, which is the same on both sides of a comparison
 * made inside one process.
 */

/** Rebuild a plain object with its keys in sorted order; leave anything else. */
function sortKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  // `Object.fromEntries` defines each key as an own property, so a JSON
  // argument named `__proto__` is kept rather than hitting the prototype
  // setter that a plain assignment onto `{}` would invoke.
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]),
  );
}

/** `value` as JSON with every object's keys sorted, recursively. */
export function canonicalJson(value: unknown): string {
  // `JSON.stringify` returns `undefined` for a bare `undefined`; a key needs a
  // string, and "absent" is the same as "no arguments" here.
  return JSON.stringify(value, sortKeys) ?? "null";
}

/**
 * The registry key for one subscription: event name, canonical arguments and
 * delivery mode. Two subscribe calls with the same three address the same
 * subscription; any difference addresses a different one.
 */
export function eventSubscriptionKey(
  name: string,
  args: Record<string, unknown> | undefined,
  mode: string,
): string {
  return canonicalJson([name, args ?? {}, mode]);
}
