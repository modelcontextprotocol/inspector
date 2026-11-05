/**
 * A display summary of an OAuth access token, for the TUI Auth tab and
 * `mcpdo auth/show` (#2845).
 *
 * Most OAuth problems with an MCP server — wrong audience, missing scope, an
 * expired token — are visible in the access token itself, but those two
 * surfaces showed it only as an opaque string. When the token is a JWT its
 * claims are decoded here **without verifying the signature** (it is a viewer,
 * not a validator — the resource server is the only party that can judge the
 * token). When it is not a JWT, the summary falls back to what the token
 * response itself carried (`scope`, `expires_in`).
 *
 * Pure: no I/O, and "now" is a parameter, so the relative times are
 * deterministic under test. Claim values are attacker-influenced text (the
 * authorization server mints them) headed for a terminal, so every string is
 * stripped of control characters before it leaves this module.
 */
import { decodeJwtPayload } from "./ema/jwt.js";

/** The token-response fields this summary reads (a subset of `OAuthTokens`). */
export interface AccessTokenSource {
  access_token: string;
  scope?: string;
  expires_in?: number;
}

export interface AccessTokenSummary {
  /** `jwt` when the payload decoded; `opaque` otherwise. */
  format: "jwt" | "opaque";
  /** `iss` claim. */
  issuer?: string;
  /** `aud` claim, normalised to a list. */
  audience?: string[];
  /** `sub` claim. */
  subject?: string;
  /** `client_id` claim (RFC 9068), falling back to `azp`. */
  clientId?: string;
  /**
   * JWT: the `scope` claim (RFC 9068), falling back to `scp`. Opaque: the
   * token response's `scope`.
   */
  scopes?: string[];
  /** `iat` claim, epoch seconds. */
  issuedAt?: number;
  /** `exp` claim, epoch seconds. */
  expiresAt?: number;
  /**
   * Opaque tokens only: the token response's `expires_in`, in seconds. It is
   * relative to when the token was issued, which the store does not record,
   * so it cannot be turned into an absolute expiry.
   */
  expiresIn?: number;
}

/** One labelled row of a rendered summary. */
export interface AccessTokenDetailLine {
  label: string;
  value: string;
}

// C0 controls, DEL and C1 controls (which include 8-bit CSI/OSC).
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

function clean(value: string): string {
  return value.replace(CONTROL_CHARS, "");
}

function stringClaim(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = clean(value).trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/** A string or an array of strings, as `aud` and `scp` may be. */
function listClaim(value: unknown): string[] | undefined {
  const items = Array.isArray(value) ? value : [value];
  const strings = items
    .map(stringClaim)
    .filter((s): s is string => s !== undefined);
  return strings.length > 0 ? strings : undefined;
}

/** A space-delimited scope string, as `scope` is. */
function scopeString(value: unknown): string[] | undefined {
  const s = stringClaim(value);
  if (s === undefined) return undefined;
  return s.split(/\s+/).filter(Boolean);
}

function numericClaim(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Summarise an access token for display. Never returns the token itself. */
export function summarizeAccessToken(
  tokens: AccessTokenSource,
): AccessTokenSummary {
  const claims = decodeJwtPayload(tokens.access_token)?.payload;
  // A segment that parses as JSON but not as an object (`null`, a string)
  // decodes without error; it carries no claims, so it reads as opaque.
  if (claims && typeof claims === "object" && !Array.isArray(claims)) {
    return {
      format: "jwt",
      issuer: stringClaim(claims.iss),
      audience: listClaim(claims.aud),
      subject: stringClaim(claims.sub),
      clientId: stringClaim(claims.client_id) ?? stringClaim(claims.azp),
      scopes: scopeString(claims.scope) ?? listClaim(claims.scp),
      issuedAt: numericClaim(claims.iat),
      expiresAt: numericClaim(claims.exp),
    };
  }
  return {
    format: "opaque",
    scopes: scopeString(tokens.scope),
    expiresIn: numericClaim(tokens.expires_in),
  };
}

/** True when the summary carries an `exp` at or before `nowMs`. */
export function isAccessTokenSummaryExpired(
  summary: AccessTokenSummary,
  nowMs: number,
): boolean {
  return summary.expiresAt !== undefined && summary.expiresAt * 1000 <= nowMs;
}

/** A compact duration: `45s`, `12m`, `3h 5m`, `2d 4h`. */
export function formatDuration(seconds: number): string {
  const s = Math.floor(Math.abs(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d}d` : `${d}d ${h % 24}h`;
}

function formatEpoch(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return Number.isNaN(date.getTime())
    ? String(epochSeconds)
    : date.toISOString();
}

function relativeTo(epochSeconds: number, nowMs: number): string {
  const delta = epochSeconds - nowMs / 1000;
  return delta >= 0
    ? `in ${formatDuration(delta)}`
    : `${formatDuration(delta)} ago`;
}

/**
 * Render a summary as labelled rows, with times relative to `nowMs`. Shared by
 * the TUI and mcpdo so the two surfaces word the same claims the same way.
 */
export function accessTokenDetailLines(
  summary: AccessTokenSummary,
  nowMs: number,
): AccessTokenDetailLine[] {
  const lines: AccessTokenDetailLine[] = [];
  if (summary.format === "jwt") {
    lines.push({ label: "Format", value: "JWT (signature not verified)" });
    if (summary.issuer) lines.push({ label: "Issuer", value: summary.issuer });
    if (summary.audience) {
      lines.push({ label: "Audience", value: summary.audience.join(", ") });
    }
    if (summary.subject) {
      lines.push({ label: "Subject", value: summary.subject });
    }
    if (summary.clientId) {
      lines.push({ label: "Client", value: summary.clientId });
    }
    if (summary.scopes) {
      lines.push({ label: "Scopes", value: summary.scopes.join(", ") });
    }
    if (summary.issuedAt !== undefined) {
      lines.push({
        label: "Issued",
        value: `${formatEpoch(summary.issuedAt)} (${relativeTo(summary.issuedAt, nowMs)})`,
      });
    }
    if (summary.expiresAt !== undefined) {
      const expired = isAccessTokenSummaryExpired(summary, nowMs);
      const rel = relativeTo(summary.expiresAt, nowMs);
      lines.push({
        label: "Expires",
        value: `${formatEpoch(summary.expiresAt)} (${expired ? `expired ${rel}` : rel})`,
      });
    } else {
      lines.push({ label: "Expires", value: "no exp claim" });
    }
    return lines;
  }
  lines.push({ label: "Format", value: "Opaque (not a JWT)" });
  if (summary.scopes) {
    lines.push({ label: "Scopes", value: summary.scopes.join(", ") });
  }
  lines.push({
    label: "Expires in",
    value:
      summary.expiresIn !== undefined
        ? `${formatDuration(summary.expiresIn)} from issuance (token response expires_in)`
        : "not stated by the token response",
  });
  return lines;
}
