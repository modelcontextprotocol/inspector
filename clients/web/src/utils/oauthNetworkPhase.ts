/**
 * Classify a captured `auth`-category network request by its OAuth flow phase,
 * so the Network tab can label discovery / registration / token / step-up
 * traffic. Purely heuristic on the request URL — the SDK owns the flow, so this
 * is presentation only and returns `undefined` when nothing matches.
 *
 * Phases follow the 2026-07-28 authorization flow: RFC 9728/8414 discovery,
 * DCR / CIMD registration (SEP-991), the authorization redirect, and the token
 * exchange (where a `403 insufficient_scope` step-up re-authorizes, SEP-2350).
 */
export type OAuthNetworkPhase =
  | "discovery"
  | "registration"
  | "authorize"
  | "token";

const PHASE_LABELS: Record<OAuthNetworkPhase, string> = {
  discovery: "Discovery",
  registration: "Registration",
  authorize: "Authorize",
  token: "Token",
};

export function oauthNetworkPhase(
  rawUrl: string,
): OAuthNetworkPhase | undefined {
  // Match on the path only; query strings and fragments are irrelevant and can
  // contain misleading substrings (e.g. a `redirect_uri` pointing at `/token`).
  let path: string;
  try {
    path = new URL(rawUrl).pathname.toLowerCase();
  } catch {
    // Not an absolute URL — fall back to the raw string, minus any query.
    path = rawUrl.toLowerCase().split(/[?#]/)[0] ?? "";
  }

  if (
    path.includes("/.well-known/oauth-protected-resource") ||
    path.includes("/.well-known/oauth-authorization-server") ||
    path.includes("/.well-known/openid-configuration")
  ) {
    return "discovery";
  }
  if (path.endsWith("/register") || path.includes("/register/")) {
    return "registration";
  }
  if (path.endsWith("/token") || path.includes("/token/")) {
    return "token";
  }
  if (path.endsWith("/authorize") || path.includes("/authorize/")) {
    return "authorize";
  }
  return undefined;
}

/** Human-readable badge label for a phase. */
export function oauthNetworkPhaseLabel(phase: OAuthNetworkPhase): string {
  return PHASE_LABELS[phase];
}
