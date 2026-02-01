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

export type OAuthStateMode = "normal" | "guided";

/**
 * Generate OAuth state with mode prefix for single-redirect-URL flow.
 * Format: {mode}:{random} (e.g. "guided:a1b2c3...").
 * The random part is 64 hex chars for CSRF protection.
 */
export const generateOAuthStateWithMode = (mode: OAuthStateMode): string => {
  const random = generateOAuthState();
  return `${mode}:${random}`;
};

/**
 * Parse OAuth state to extract mode and random part.
 * Returns null if invalid.
 * Legacy state (plain 64-char hex, no prefix) is treated as mode "normal".
 */
export const parseOAuthState = (
  state: string,
): { mode: OAuthStateMode; random: string } | null => {
  if (!state || typeof state !== "string") return null;
  if (state.startsWith("normal:")) {
    return { mode: "normal", random: state.slice(7) };
  }
  if (state.startsWith("guided:")) {
    return { mode: "guided", random: state.slice(7) };
  }
  // Legacy: plain 64-char hex
  if (/^[a-f0-9]{64}$/i.test(state)) {
    return { mode: "normal", random: state };
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
