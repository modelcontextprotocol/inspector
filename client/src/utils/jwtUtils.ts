/**
 * Utilities for decoding JWT tokens (JWS format)
 */

export interface DecodedJWT {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

/**
 * Checks if a string looks like a JWT (JWS format: header.payload.signature)
 */
export function isJWT(token: string): boolean {
  if (!token || typeof token !== "string") {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }

  // Check if each part is valid base64url
  const base64urlRegex = /^[A-Za-z0-9_-]*$/;
  return parts.every((part) => base64urlRegex.test(part));
}

/**
 * Decodes a base64url string to a regular string
 */
function base64urlDecode(str: string): string {
  // Replace base64url characters with base64 characters
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");

  // Add padding if needed
  const padding = base64.length % 4;
  if (padding) {
    base64 += "=".repeat(4 - padding);
  }

  return atob(base64);
}

/**
 * Decodes a JWT token and returns the header and payload as objects.
 * Does NOT verify the signature - this is for display purposes only.
 *
 * @param token - The JWT token string
 * @returns The decoded header and payload, or null if decoding fails
 */
export function decodeJWT(token: string): DecodedJWT | null {
  if (!isJWT(token)) {
    return null;
  }

  try {
    const parts = token.split(".");
    const header = JSON.parse(base64urlDecode(parts[0]));
    const payload = JSON.parse(base64urlDecode(parts[1]));

    return { header, payload };
  } catch {
    return null;
  }
}
