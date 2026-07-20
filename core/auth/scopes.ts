/**
 * SEP-2350 scope helpers. Union / strict-superset algorithms come from
 * `@modelcontextprotocol/client`; Inspector-only persistence helpers stay local.
 */

import {
  computeScopeUnion as sdkComputeScopeUnion,
  isStrictScopeSuperset as sdkIsStrictScopeSuperset,
} from "@modelcontextprotocol/client";

/** Union space-delimited scope strings (order-preserving, deduped). */
export const computeScopeUnion = sdkComputeScopeUnion;

/**
 * Whether `union` contains a scope token not present in `current`.
 * When the AS omits `scope` on the token response, `current` is empty and any
 * non-empty union is a strict superset — step-up must re-authorize, not refresh.
 */
export const isStrictScopeSuperset = sdkIsStrictScopeSuperset;

/**
 * Scope to persist after a successful token grant (RFC 6749 §5.1).
 * When the AS returns `scope`, it is the authoritative full grant.
 * When `scope` is omitted on success, granted equals what was requested.
 */
export function resolvePersistedScopeAfterGrant(
  grantedScope: string | undefined,
  requestedScope: string | undefined,
): string | undefined {
  const granted = grantedScope?.trim();
  if (granted) {
    return granted;
  }
  const requested = requestedScope?.trim();
  return requested || undefined;
}

/**
 * Scope coverage for satisfaction checks: prefer the token's explicit grant;
 * when omitted, fall back to stored scope (RFC implied grant on prior success).
 */
export function resolveEffectiveGrantedScope(
  storedScope: string | undefined,
  tokenScope: string | undefined,
): string | undefined {
  const granted = tokenScope?.trim();
  if (granted) {
    return granted;
  }
  return computeScopeUnion(storedScope, tokenScope);
}
