/**
 * SEP-2207: the SDK refuses to send credentials to a non-TLS token endpoint
 * whose host is outside its loopback exemption (`localhost` / `127.0.0.1` /
 * `::1`), throwing `InsecureTokenEndpointError` from inside
 * `executeTokenRequest`.
 *
 * That error is **terminal by design**. It does not extend `OAuthError`, and
 * `auth()` special-cases it to rethrow rather than fall through to a fresh
 * `/authorize` redirect — so nothing the Inspector does can make a retry
 * succeed. Recognizing it is what lets the UI say so, instead of offering a
 * "Re-authenticate" affordance that can only fail the same way (#2280).
 *
 * The check is not a fix for `*.localhost` (#1944): the exemption list lives in
 * the SDK and takes no options, so widening it has to happen upstream
 * (typescript-sdk#2591). This is about how the refusal is *reported* — which
 * matters for every endpoint outside that exemption, `host.docker.internal` and
 * LAN hostnames included, not only the `.localhost` case.
 */

import { InsecureTokenEndpointError } from "@modelcontextprotocol/client";

/** The fields this module needs off the SDK error, once recognized. */
export interface InsecureTokenEndpointShape {
  /** The token endpoint URL the SDK refused to post credentials to. */
  tokenEndpoint: string;
}

/**
 * Recognize the SDK's `InsecureTokenEndpointError` itself (not a wrapper).
 *
 * Uses the SDK's own `isInstance` predicate, which is cross-copy safe by
 * construction: the SDK stamps each instance with a brand set keyed by
 * `Symbol.for("mcp.sdk.errorBrands")` and overrides `Symbol.hasInstance` to
 * consult it, so an error thrown by a different bundled copy still matches.
 * (The brand constant is `static`, so it is never reachable as `err.mcpBrand`
 * on an instance — don't check that property.)
 *
 * The `name` comparison is the same deliberate serialization fallback
 * `isAuthorizationServerMismatchShape` carries in `issuerBinding.ts`: today the
 * web client runs `auth()` in the browser, so no boundary is crossed, but the
 * prototype and brand set are the first things a structured clone or a JSON hop
 * would drop, and `name` survives both.
 */
function isInsecureTokenEndpointShape(
  err: unknown,
): err is InsecureTokenEndpointShape {
  if (err === null || typeof err !== "object") {
    return false;
  }
  const candidate = err as { tokenEndpoint?: unknown; name?: unknown };
  if (typeof candidate.tokenEndpoint !== "string") {
    return false;
  }
  return (
    InsecureTokenEndpointError.isInstance(err) ||
    candidate.name === "InsecureTokenEndpointError"
  );
}

/**
 * Find an insecure-token-endpoint refusal anywhere in an error's `cause` /
 * `data.cause` chain, and return the shape that carries the endpoint.
 *
 * Walking the chain is not defensive padding: era negotiation and the transport
 * wrappers bury the original rejection, so a top-level-only check would miss the
 * connect and refresh paths and let exactly the retryable UI this exists to
 * remove render anyway. `findIssuerBindingFailure` in `issuerBinding.ts` walks
 * the same two links for the same reason, and this deliberately mirrors it —
 * including the `seen` set, which keeps a self-referential `cause` from looping.
 */
export function findInsecureTokenEndpoint(
  err: unknown,
): InsecureTokenEndpointShape | undefined {
  return findInsecureTokenEndpointDeep(err, new Set());
}

function findInsecureTokenEndpointDeep(
  err: unknown,
  seen: Set<unknown>,
): InsecureTokenEndpointShape | undefined {
  if (err === null || typeof err !== "object" || seen.has(err)) {
    return undefined;
  }
  seen.add(err);

  if (isInsecureTokenEndpointShape(err)) {
    return err;
  }

  const nested = findInsecureTokenEndpointDeep(
    (err as { cause?: unknown }).cause,
    seen,
  );
  if (nested) {
    return nested;
  }

  const data = (err as { data?: unknown }).data;
  if (data !== null && typeof data === "object") {
    return findInsecureTokenEndpointDeep(
      (data as { cause?: unknown }).cause,
      seen,
    );
  }

  return undefined;
}
