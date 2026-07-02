/**
 * SEP-2350 scope helpers aligned with v2 `@modelcontextprotocol/client` exports.
 * On SDK v2 upgrade, delete this module and import `computeScopeUnion` /
 * `isStrictScopeSuperset` from the client package instead.
 */

import {
  parseScopeString,
  unionAuthorizationScopes,
} from "./challenge.js";

/** Union space-delimited scope strings (order-preserving, deduped). */
export function computeScopeUnion(
  ...scopes: ReadonlyArray<string | undefined>
): string | undefined {
  let merged: string | undefined;
  for (const scope of scopes) {
    merged = unionAuthorizationScopes(merged, parseScopeString(scope)).join(
      " ",
    );
    if (!merged) {
      merged = undefined;
    }
  }
  return merged;
}

/**
 * Whether `union` contains a scope token not present in `current`.
 * When the AS omits `scope` on the token response, `current` is empty and any
 * non-empty union is a strict superset — step-up must re-authorize, not refresh.
 */
export function isStrictScopeSuperset(
  union: string | undefined,
  current: string | undefined,
): boolean {
  if (!union) return false;
  const currentSet = new Set((current ?? "").split(/\s+/).filter(Boolean));
  for (const token of union.split(/\s+/)) {
    if (token && !currentSet.has(token)) return true;
  }
  return false;
}
