import { isUnauthorizedError } from "./utils.js";

/** Why authorization failed for this MCP interaction. */
export type AuthChallengeReason =
  | "unauthorized"
  | "token_expired"
  | "insufficient_scope"
  | "invalid_token";

/** Normalized challenge for handleAuthChallenge(). */
export interface AuthChallenge {
  reason: AuthChallengeReason;

  /** Scopes from the current challenge (step-up). */
  requiredScopes?: string[];

  /**
   * For step-up (SEP-2350): union of previously requested scopes and requiredScopes.
   * Set by handleAuthChallenge before re-authorization; not sent on the wire.
   */
  authorizationScopes?: string[];

  /** Resource indicator / MCP resource URL when known (EMA RFC 8707). */
  resource?: string;

  /** Resource authorization server audience when known. */
  audience?: string;

  /** Optional human-readable detail from server or SDK (for UI, not parsing). */
  message?: string;

  /** Optional UX hints when known (not used for ambient RPC replay). */
  context?: {
    method?: string;
    toolName?: string;
  };

  /** Opaque raw hints for logging and forward-compatible parsers. */
  raw?: {
    httpStatus?: number;
    wwwAuthenticate?: string;
  };
}

export type AuthChallengeOutcome =
  | { kind: "satisfied" }
  | { kind: "interactive"; authorizationUrl: URL; challenge: AuthChallenge }
  | { kind: "step_up_confirm"; challenge: AuthChallenge }
  | { kind: "failed"; error: Error };

/** Placeholder URL when EMA step-up awaits in-app confirmation (no redirect yet). */
export const EMA_STEP_UP_PENDING_URL = new URL("mcp-inspector:ema-step-up");

export interface HandleAuthChallengeOptions {
  /** User confirmed step-up in Inspector UI — run silent EMA re-mint / IdP redirect. */
  confirmedStepUp?: boolean;
}

export interface ParseAuthChallengeContext {
  method?: string;
  toolName?: string;
}

export class AuthChallengeError extends Error {
  readonly authChallenge: AuthChallenge;
  readonly status: number;

  constructor(authChallenge: AuthChallenge, status: number, message?: string) {
    super(message ?? `Auth challenge: ${authChallenge.reason}`);
    this.name = "AuthChallengeError";
    this.authChallenge = authChallenge;
    this.status = status;
  }
}

/** Thrown when interactive auth recovery was started and the caller should wait for callback. */
export class AuthRecoveryRequiredError extends Error {
  readonly authorizationUrl: URL;
  readonly authChallenge: AuthChallenge;
  /** EMA insufficient_scope awaiting user confirmation in Inspector (no redirect yet). */
  readonly emaStepUpConfirm?: boolean;

  constructor(
    authorizationUrl: URL,
    authChallenge: AuthChallenge,
    options?: { emaStepUpConfirm?: boolean },
  ) {
    super("Interactive auth recovery required");
    this.name = "AuthRecoveryRequiredError";
    this.authorizationUrl = authorizationUrl;
    this.authChallenge = authChallenge;
    this.emaStepUpConfirm = options?.emaStepUpConfirm;
  }
}

/**
 * Connect-time failures the app can recover via OAuth redirect. These are not
 * terminal connection errors — the UI should stay on "connecting" until the
 * redirect or an explicit recovery failure.
 */
export function isConnectAuthRecoveryError(err: unknown): boolean {
  if (err instanceof AuthRecoveryRequiredError) return true;
  return isUnauthorizedError(err);
}

export interface WwwAuthenticateBearerParams {
  error?: string;
  scope?: string;
  resourceMetadata?: string;
  errorDescription?: string;
}

/** Parse the first `WWW-Authenticate: Bearer …` challenge (RFC 6750). */
export function parseWwwAuthenticateBearer(
  header: string,
): WwwAuthenticateBearerParams {
  const match = header.match(/Bearer\s+(.+)/i);
  if (!match) {
    return {};
  }

  const params: Record<string, string> = {};
  const paramRegex = /([\w-]+)(?:="([^"]*)"|=([^\s,]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = paramRegex.exec(match[1])) !== null) {
    const value = m[2] ?? m[3];
    if (value !== undefined) {
      params[m[1].toLowerCase()] = value;
    }
  }

  return {
    error: params.error,
    scope: params.scope,
    resourceMetadata: params.resource_metadata,
    errorDescription: params.error_description,
  };
}

/** Split an OAuth scope string into individual scopes (space-separated). */
export function parseScopeString(scope: string | undefined): string[] {
  if (!scope?.trim()) {
    return [];
  }
  return scope.trim().split(/\s+/).filter(Boolean);
}

/**
 * SEP-2350: union of previously requested scopes and scopes from the current challenge.
 * Preserves order: previous scopes first, then any new required scopes.
 */
export function unionAuthorizationScopes(
  previousScope: string | undefined,
  requiredScopes: string[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const scope of [
    ...parseScopeString(previousScope),
    ...requiredScopes.filter(Boolean),
  ]) {
    if (!seen.has(scope)) {
      seen.add(scope);
      result.push(scope);
    }
  }

  return result;
}

function reasonFromHttpResponse(
  status: number,
  bearer: WwwAuthenticateBearerParams,
): AuthChallengeReason {
  if (status === 403) {
    if (bearer.error === "insufficient_scope") {
      return "insufficient_scope";
    }
    return "unauthorized";
  }

  if (bearer.error === "insufficient_scope") {
    return "insufficient_scope";
  }

  if (bearer.error === "invalid_token") {
    return "invalid_token";
  }

  // Bare 401 without a Bearer error code — treat as expired token for silent
  // refresh / reauth UX (connect-time 401 uses isUnauthorizedError separately).
  if (status === 401) {
    return "token_expired";
  }

  return "unauthorized";
}

/**
 * Build an AuthChallenge from an MCP HTTP response (401 / 403).
 * Returns undefined when the response is not an auth challenge.
 */
export function parseAuthChallengeFromResponse(
  response: Response,
  context?: ParseAuthChallengeContext,
): AuthChallenge | undefined {
  const status = response.status;
  if (status !== 401 && status !== 403) {
    return undefined;
  }

  const wwwAuthenticate = response.headers.get("WWW-Authenticate") ?? undefined;
  const bearer = wwwAuthenticate
    ? parseWwwAuthenticateBearer(wwwAuthenticate)
    : {};
  const requiredScopes = parseScopeString(bearer.scope);

  return {
    reason: reasonFromHttpResponse(status, bearer),
    ...(requiredScopes.length > 0 ? { requiredScopes } : {}),
    ...(bearer.errorDescription ? { message: bearer.errorDescription } : {}),
    ...(context ? { context } : {}),
    raw: {
      httpStatus: status,
      ...(wwwAuthenticate ? { wwwAuthenticate } : {}),
    },
  };
}

/** Best-effort challenge extraction from SDK / transport errors. */
export function parseAuthChallengeFromError(
  err: unknown,
  context?: ParseAuthChallengeContext,
): AuthChallenge | undefined {
  if (err instanceof AuthChallengeError) {
    return err.authChallenge;
  }

  if (typeof err !== "object" || err === null) {
    return undefined;
  }

  const authChallenge = (err as { authChallenge?: AuthChallenge })
    .authChallenge;
  if (authChallenge?.reason) {
    return {
      ...authChallenge,
      ...(context
        ? {
            context: {
              ...authChallenge.context,
              ...context,
            },
          }
        : {}),
    };
  }

  const status =
    (err as { status?: number }).status ?? (err as { code?: number }).code;
  if (status !== 401 && status !== 403) {
    return undefined;
  }

  const wwwAuthenticate =
    authChallenge?.raw?.wwwAuthenticate ??
    (err as { wwwAuthenticate?: string }).wwwAuthenticate ??
    (
      err as { headers?: { get?: (name: string) => string | null } }
    ).headers?.get?.("WWW-Authenticate") ??
    undefined;

  if (!wwwAuthenticate?.length) {
    return undefined;
  }

  const bearer = parseWwwAuthenticateBearer(wwwAuthenticate);
  const requiredScopes = parseScopeString(bearer.scope);

  return {
    reason: reasonFromHttpResponse(status, bearer),
    ...(requiredScopes.length > 0 ? { requiredScopes } : {}),
    ...(context ? { context } : {}),
    raw: {
      httpStatus: status,
      wwwAuthenticate,
    },
  };
}

/**
 * True for mid-session auth failures (HTTP 401 or 403 on MCP traffic).
 * Connect-time 401 detection remains {@link isUnauthorizedError} in utils.ts.
 *
 * Bare HTTP status codes alone are not treated as auth challenges — require
 * {@link AuthChallengeError}, an embedded `authChallenge`, or `WWW-Authenticate`.
 */
export function isAuthChallengeError(err: unknown): boolean {
  if (err instanceof AuthChallengeError) {
    return true;
  }

  if (typeof err !== "object" || err === null) {
    return false;
  }

  const authChallenge = (err as { authChallenge?: AuthChallenge })
    .authChallenge;
  if (authChallenge?.reason) {
    return true;
  }

  const status =
    (err as { status?: number }).status ?? (err as { code?: number }).code;
  if (status !== 401 && status !== 403) {
    return false;
  }

  const wwwAuthenticate =
    authChallenge?.raw?.wwwAuthenticate ??
    (err as { wwwAuthenticate?: string }).wwwAuthenticate ??
    (
      err as { headers?: { get?: (name: string) => string | null } }
    ).headers?.get?.("WWW-Authenticate") ??
    undefined;

  return wwwAuthenticate !== undefined && wwwAuthenticate.length > 0;
}
