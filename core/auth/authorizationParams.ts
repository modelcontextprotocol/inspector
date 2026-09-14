/**
 * Per-server custom authorization-request parameters (#2018).
 *
 * Real deployments gate IdP selection, prompt behavior, or audience on a query
 * parameter the OAuth/OIDC core specs never standardized — Keycloak's
 * `kc_idp_hint`, OIDC's `login_hint` / `prompt` / `acr_values`, Auth0's
 * `audience`. The Inspector never builds the authorize URL itself (the SDK's
 * `auth()` does, and exposes no hook for extra parameters), so the merge
 * happens at the one seam that sees the finished URL:
 * `BaseOAuthClientProvider.redirectToAuthorization`.
 *
 * The parameters apply to the **authorization request only** — never the token
 * request, which the SDK builds separately and which this module is not wired
 * into. They also apply only to the server's **own** authorization server:
 * the enterprise-managed (EMA) leg redirects to a different one (the enterprise
 * IdP) and goes through `BaseOAuthClientProvider.redirectToExternalAuthorization`,
 * which deliberately skips the merge.
 */

/**
 * Parameters the OAuth flow owns and a user may not override.
 *
 * Overriding any of these does not produce a useful debugging scenario — it
 * breaks PKCE (`code_challenge`, `code_challenge_method`), CSRF binding
 * (`state`), the callback leg (`redirect_uri`, `response_type`, `client_id`),
 * or RFC 8707 resource indicators (`resource`), and the failure surfaces as an
 * opaque authorization-server error rather than as an Inspector problem.
 * `scope` is excluded too: it has its own field, and the SEP-2350 step-up union
 * is computed from that field rather than from these parameters.
 */
export const RESERVED_AUTHORIZATION_PARAMS = [
  "client_id",
  "code_challenge",
  "code_challenge_method",
  "redirect_uri",
  "resource",
  "response_type",
  "scope",
  "state",
] as const;

export type ReservedAuthorizationParam =
  (typeof RESERVED_AUTHORIZATION_PARAMS)[number];

const RESERVED: ReadonlySet<string> = new Set(RESERVED_AUTHORIZATION_PARAMS);

/**
 * Whether `key` names a parameter the OAuth flow owns. Compared case- and
 * whitespace-insensitively: query parameter names are case-sensitive on the
 * wire, but a `Client_Id` typed into the form is plainly an attempt to set the
 * reserved one, and letting it through would be the silent override this rule
 * exists to prevent.
 */
export function isReservedAuthorizationParam(key: string): boolean {
  return RESERVED.has(key.trim().toLowerCase());
}

/**
 * Validation message for one authorization-parameter key, or `undefined` when
 * the key is acceptable. A blank key is not an error — the form lets a user
 * leave a freshly-added row empty mid-edit, and blank rows are dropped rather
 * than rejected.
 */
export function authorizationParamKeyError(key: string): string | undefined {
  const trimmed = key.trim();
  if (trimmed === "") return undefined;
  if (isReservedAuthorizationParam(trimmed)) {
    return `"${trimmed}" is set by the authorization flow and cannot be overridden.`;
  }
  return undefined;
}

/**
 * Merge custom parameters into a finished authorization URL.
 *
 * Blank keys are skipped (a half-edited form row) and reserved keys are dropped
 * with a warning — never silently, and never overriding what the SDK put there.
 * Returns the original URL instance when there is nothing to apply, and
 * otherwise a copy, so the caller's URL is never mutated.
 */
export function applyAuthorizationParams(
  authorizationUrl: URL,
  params: Record<string, string> | undefined,
): URL {
  if (!params) return authorizationUrl;

  const applicable = Object.entries(params).filter(([key]) => {
    if (key.trim() === "") return false;
    if (isReservedAuthorizationParam(key)) {
      console.warn(
        `[oauth] Ignoring reserved authorization parameter "${key.trim()}" — it is set by the authorization flow.`,
      );
      return false;
    }
    return true;
  });

  if (applicable.length === 0) return authorizationUrl;

  const merged = new URL(authorizationUrl.href);
  for (const [key, value] of applicable) {
    merged.searchParams.set(key.trim(), value);
  }
  return merged;
}
