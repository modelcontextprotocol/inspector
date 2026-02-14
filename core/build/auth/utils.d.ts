import type { CallbackParams } from "./types.js";
/**
 * Parses OAuth 2.1 callback parameters from a URL search string
 * @param location The URL search string (e.g., "?code=abc123" or "?error=access_denied")
 * @returns Parsed callback parameters with success/error information
 */
export declare const parseOAuthCallbackParams: (location: string) => CallbackParams;
/**
 * Generate a random state for the OAuth 2.0 flow.
 * Works in both browser and Node.js environments.
 *
 * @returns A random state for the OAuth 2.0 flow.
 */
export declare const generateOAuthState: () => string;
export type OAuthStateMode = "normal" | "guided";
/**
 * Generate OAuth state with mode prefix for single-redirect-URL flow.
 * Format: {mode}:{authId} (e.g. "guided:a1b2c3...").
 * The authId part is 64 hex chars for CSRF protection and serves as session identifier.
 */
export declare const generateOAuthStateWithMode: (mode: OAuthStateMode) => string;
/**
 * Parse OAuth state to extract mode and authId part.
 * Returns null if invalid.
 * Legacy state (plain 64-char hex, no prefix) is treated as mode "normal".
 */
export declare const parseOAuthState: (state: string) => {
    mode: OAuthStateMode;
    authId: string;
} | null;
/**
 * Generates a human-readable error description from OAuth callback error parameters
 * @param params OAuth error callback parameters containing error details
 * @returns Formatted multiline error message with error code, description, and optional URI
 */
export declare const generateOAuthErrorDescription: (params: Extract<CallbackParams, {
    successful: false;
}>) => string;
//# sourceMappingURL=utils.d.ts.map