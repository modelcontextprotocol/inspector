/**
 * SEP-2352 issuer-binding failure classification.
 *
 * On the authorization-code callback leg the SDK compares the authorization
 * server resolved by discovery against the one recorded in `discoveryState()`
 * at redirect time, and throws `AuthorizationServerMismatchError` when the two
 * cannot be reconciled. That single error class covers two very different
 * situations:
 *
 * 1. **Lost authorization state** — no discovery state was recorded at all
 *    (`recordedIssuer === undefined` inside the SDK). This is a *recoverable*
 *    bookkeeping failure: the stored authorization state for the server was
 *    dropped between the redirect and the callback (a new browser session, a
 *    partially cleared store, a callback resumed in another tab). Nothing
 *    suspicious happened — the user just has to authorize again.
 * 2. **Genuine issuer mismatch** — a real issuer *was* recorded and the callback
 *    resolved a different one. This is a security signal (RFC 7636: the
 *    `authorization_code` and `code_verifier` are bound to the AS that minted
 *    them; replaying them at another AS's token endpoint is a credential
 *    exfiltration vector). It must never be papered over with a friendly
 *    "just re-authorize" affordance.
 *
 * The SDK does not expose a discriminator, so we key off the shape of
 * `recordedIssuer`: in the "lost state" case the SDK passes a human-readable
 * sentence in the `recordedIssuer` slot ("discoveryState was not available on
 * the callback leg; …"); a genuine mismatch always carries an absolute
 * `http(s)` issuer URL there. We accept either signal — the sentinel phrase or
 * "not a URL" — so a reworded SDK sentence still classifies correctly.
 */

/** Brand the SDK stamps on `AuthorizationServerMismatchError` instances. */
const AS_MISMATCH_BRAND = "mcp.AuthorizationServerMismatchError";

/** Phrase the SDK puts in the `recordedIssuer` slot when nothing was recorded. */
const MISSING_DISCOVERY_STATE_PHRASE = "discoveryState was not available";

/** Outcome of classifying a callback-leg issuer-binding failure. */
export type IssuerBindingFailure =
  | {
      /** No discovery state was recorded — recoverable by authorizing again. */
      kind: "lost_authorization_state";
      /** Issuer resolved by discovery on the callback leg. */
      currentIssuer: string;
    }
  | {
      /** A different authorization server answered the callback — security signal. */
      kind: "issuer_mismatch";
      /** Issuer recorded at redirect time. */
      recordedIssuer: string;
      /** Issuer resolved by discovery on the callback leg. */
      currentIssuer: string;
    };

interface AuthorizationServerMismatchShape {
  recordedIssuer: string;
  currentIssuer: string;
}

/**
 * Structural check for the SDK's `AuthorizationServerMismatchError`.
 *
 * Deliberately brand/shape based rather than `instanceof`: the error can be
 * constructed by a different copy of the SDK than the one this module imports
 * (bundled client vs. the backend's), which makes `instanceof` unreliable.
 */
function isAuthorizationServerMismatchShape(
  err: unknown,
): err is AuthorizationServerMismatchShape {
  if (err === null || typeof err !== "object") {
    return false;
  }
  const candidate = err as {
    mcpBrand?: unknown;
    recordedIssuer?: unknown;
    currentIssuer?: unknown;
  };
  return (
    candidate.mcpBrand === AS_MISMATCH_BRAND &&
    typeof candidate.recordedIssuer === "string" &&
    typeof candidate.currentIssuer === "string"
  );
}

/** True when `recordedIssuer` is the SDK's "nothing was recorded" placeholder. */
function isMissingDiscoveryStatePlaceholder(recordedIssuer: string): boolean {
  if (recordedIssuer.includes(MISSING_DISCOVERY_STATE_PHRASE)) {
    return true;
  }
  // A genuine recorded issuer is always an absolute http(s) URL, so anything
  // else in that slot is prose the SDK put there in place of an issuer.
  try {
    const url = new URL(recordedIssuer);
    return url.protocol !== "http:" && url.protocol !== "https:";
  } catch {
    return true;
  }
}

/**
 * Find and classify a SEP-2352 issuer-binding failure anywhere in an error's
 * `cause` / `data.cause` chain (era-negotiation and transport wrappers bury the
 * original rejection, see `findNestedAuthError`).
 */
export function findIssuerBindingFailure(
  err: unknown,
): IssuerBindingFailure | undefined {
  return findIssuerBindingFailureDeep(err, new Set());
}

function findIssuerBindingFailureDeep(
  err: unknown,
  seen: Set<unknown>,
): IssuerBindingFailure | undefined {
  if (err === null || typeof err !== "object" || seen.has(err)) {
    return undefined;
  }
  seen.add(err);

  if (isAuthorizationServerMismatchShape(err)) {
    return classifyAuthorizationServerMismatch(err);
  }

  const nested = findIssuerBindingFailureDeep(
    (err as { cause?: unknown }).cause,
    seen,
  );
  if (nested) {
    return nested;
  }

  const data = (err as { data?: unknown }).data;
  if (data !== null && typeof data === "object") {
    return findIssuerBindingFailureDeep(
      (data as { cause?: unknown }).cause,
      seen,
    );
  }

  return undefined;
}

function classifyAuthorizationServerMismatch(
  err: AuthorizationServerMismatchShape,
): IssuerBindingFailure {
  if (isMissingDiscoveryStatePlaceholder(err.recordedIssuer)) {
    return {
      kind: "lost_authorization_state",
      currentIssuer: err.currentIssuer,
    };
  }
  return {
    kind: "issuer_mismatch",
    recordedIssuer: err.recordedIssuer,
    currentIssuer: err.currentIssuer,
  };
}

/** True when the callback failed only because the recorded state was lost. */
export function isLostAuthorizationStateError(err: unknown): boolean {
  return findIssuerBindingFailure(err)?.kind === "lost_authorization_state";
}
