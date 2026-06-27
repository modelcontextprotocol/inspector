import type { CallbackParams } from "./types.js";

/**
 * Parse a string as an absolute URL. On failure, throws with `label` and the
 * offending value so callers (and UI toasts) can show what to fix.
 */
export function parseHttpUrl(value: string, label: string): URL {
  const trimmed = value.trim();
  try {
    return new URL(trimmed);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid ${label}: "${trimmed}" (${detail})`);
  }
}

/**
 * Parses OAuth 2.1 callback parameters from a URL search string
 * @param location The URL search string (e.g., "?code=abc123" or "?error=access_denied")
 * @returns Parsed callback parameters with success/error information
 */
export const parseOAuthCallbackParams = (location: string): CallbackParams => {
  const params = new URLSearchParams(location);

  const code = params.get("code");
  if (code) {
    return { successful: true, code };
  }

  const error = params.get("error");
  const error_description = params.get("error_description");
  const error_uri = params.get("error_uri");

  if (error) {
    return { successful: false, error, error_description, error_uri };
  }

  return {
    successful: false,
    error: "invalid_request",
    error_description: "Missing code or error in response",
    error_uri: null,
  };
};

/**
 * Generate a random state for the OAuth 2.0 flow.
 * Works in both browser and Node.js environments.
 *
 * @returns A random state for the OAuth 2.0 flow.
 */
export const generateOAuthState = (): string => {
  // Generate a random state
  const array = new Uint8Array(32);

  // Use crypto.getRandomValues (available in both browser and Node.js)
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    // Fallback for environments without crypto.getRandomValues
    // This should not happen in modern environments
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};

/**
 * Parse OAuth `state` to extract the auth session id (CSRF token).
 * Must be the 64-char hex value from {@link generateOAuthState}.
 */
export const parseOAuthState = (state: string): { authId: string } | null => {
  if (!state || typeof state !== "string") return null;
  if (/^[a-f0-9]{64}$/i.test(state)) {
    return { authId: state };
  }
  return null;
};

/**
 * Generates a human-readable error description from OAuth callback error parameters
 * @param params OAuth error callback parameters containing error details
 * @returns Formatted multiline error message with error code, description, and optional URI
 */
export const generateOAuthErrorDescription = (
  params: Extract<CallbackParams, { successful: false }>,
): string => {
  const error = params.error;
  const errorDescription = params.error_description;
  const errorUri = params.error_uri;

  return [
    `Error: ${error}.`,
    errorDescription ? `Details: ${errorDescription}.` : "",
    errorUri ? `More info: ${errorUri}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

/**
 * True when a thrown connect error represents an upstream 401. The remote
 * transport preserves the status on the error object; as a fallback, match
 * transport wording `"failed …(401)"` so unrelated `(401)` in messages does
 * not trigger OAuth.
 */
export function isUnauthorizedError(err: unknown): boolean {
  if (typeof err === "object" && err !== null) {
    const status = (err as { status?: number; code?: number }).status;
    const code = (err as { code?: number }).code;
    if (status === 401 || code === 401) return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /\bfailed\b[^\n]*\(401\)/i.test(message);
}
