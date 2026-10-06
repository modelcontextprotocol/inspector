import { redactUrlsInText } from "@inspector/core/mcp/fetchTracking.js";

/**
 * The TUI's display boundary for error text (#2490).
 *
 * A server or SDK error whose text quotes `https://…?code=…` would otherwise be
 * drawn on screen verbatim — a screenshot or screen-share away from leaking an
 * OAuth code, access token or client secret. Everything the TUI shows from a
 * caught error goes through one of these, which apply core's
 * {@link redactUrlsInText} (the same redaction the CLI's stderr envelope and
 * the web client's toasts use): sensitive query values are replaced, while the
 * path and non-sensitive parameters stay readable.
 *
 * Redaction is applied only to what is displayed, never to what is classified
 * — callers keep reading the original error for `instanceof` checks.
 */

/** The display text of a caught value: an Error's message, else `String(err)`. */
export function errorMessage(err: unknown): string {
  return redactUrlsInText(err instanceof Error ? err.message : String(err));
}

/** Redact URL query secrets in free text that is about to be displayed. */
export function redactErrorText(text: string): string {
  return redactUrlsInText(text);
}

/**
 * Pretty-printed JSON of an error-details value, with URL query secrets
 * redacted. The URL pattern stops at a double quote, so a URL inside a
 * serialized string value is redacted without disturbing the JSON around it.
 */
export function redactedJson(value: unknown): string {
  // `JSON.stringify` returns undefined for `undefined` / a function.
  return redactUrlsInText(JSON.stringify(value, null, 2) ?? String(value));
}
