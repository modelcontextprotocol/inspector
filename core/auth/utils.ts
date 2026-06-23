import type { CallbackParams } from "./types.js";

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
  // OAuth state is a CSRF token — it MUST be unpredictable. crypto.getRandomValues
  // is available in every supported runtime (browsers, Node ≥15); if it's somehow
  // missing, fail loudly rather than silently degrading to Math.random (whose
  // output is predictable from a small amount of observed state).
  if (typeof crypto === "undefined" || !crypto.getRandomValues) {
    throw new Error(
      "crypto.getRandomValues is not available; refusing to generate an OAuth state with a non-cryptographic RNG.",
    );
  }
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};

export type OAuthStateMode = "normal" | "guided";

/**
 * Generate OAuth state with mode prefix for single-redirect-URL flow.
 * Format: {mode}:{authId} (e.g. "guided:a1b2c3...").
 * The authId part is 64 hex chars for CSRF protection and serves as session identifier.
 */
export const generateOAuthStateWithMode = (mode: OAuthStateMode): string => {
  const authId = generateOAuthState();
  return `${mode}:${authId}`;
};

/**
 * Parse OAuth state to extract mode and authId part.
 * Returns null if invalid.
 * Legacy state (plain 64-char hex, no prefix) is treated as mode "normal".
 */
export const parseOAuthState = (
  state: string,
): { mode: OAuthStateMode; authId: string } | null => {
  if (!state || typeof state !== "string") return null;
  if (state.startsWith("normal:")) {
    return { mode: "normal", authId: state.slice(7) };
  }
  if (state.startsWith("guided:")) {
    return { mode: "guided", authId: state.slice(7) };
  }
  // Legacy: plain 64-char hex
  if (/^[a-f0-9]{64}$/i.test(state)) {
    return { mode: "normal", authId: state };
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
