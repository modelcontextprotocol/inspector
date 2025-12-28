/**
 * Check if a hostname is a private/internal IP address
 * Used to prevent SSRF attacks by blocking requests to internal networks
 */
function isPrivateHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();

  // Private IP patterns
  const privatePatterns = [
    // Localhost variants
    /^localhost$/,
    /^localhost\./,

    // IPv4 private ranges
    /^127\./, // 127.0.0.0/8 - loopback
    /^10\./, // 10.0.0.0/8 - private
    /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12 - private
    /^192\.168\./, // 192.168.0.0/16 - private
    /^169\.254\./, // 169.254.0.0/16 - link-local
    /^0\./, // 0.0.0.0/8 - current network

    // IPv6 private ranges (enclosed in brackets for URL hostname)
    /^\[::1\]$/, // ::1 - loopback
    /^\[::ffff:127\./, // IPv4-mapped loopback
    /^\[fe80:/i, // fe80::/10 - link-local
    /^\[fc/i, // fc00::/7 - unique local
    /^\[fd/i, // fd00::/8 - unique local

    // Cloud metadata endpoints (common SSRF targets)
    /^169\.254\.169\.254$/, // AWS/GCP metadata
    /^metadata\./, // metadata.google.internal
  ];

  return privatePatterns.some((pattern) => pattern.test(normalizedHostname));
}

/**
 * Validates that a URL is safe for redirection.
 * - Only allows HTTP and HTTPS protocols to prevent XSS attacks
 * - Blocks private/internal IPs to prevent SSRF attacks
 *
 * @param url - The URL string to validate
 * @param options - Validation options
 * @param options.allowPrivateIPs - If true, allows private IPs (default: false)
 * @throws Error if the URL has an unsafe protocol or points to private networks
 */
export function validateRedirectUrl(
  url: string | URL,
  options: { allowPrivateIPs?: boolean } = {},
): void {
  try {
    const parsedUrl = new URL(url);

    // Check protocol
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Authorization URL must be HTTP or HTTPS");
    }

    // Check for private/internal IPs (SSRF protection)
    if (!options.allowPrivateIPs && isPrivateHostname(parsedUrl.hostname)) {
      throw new Error(
        `Authorization URL cannot point to private/internal address: ${parsedUrl.hostname}`,
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("Authorization URL") ||
        error.message.startsWith("Authorization URL cannot"))
    ) {
      throw error;
    }
    // If URL parsing fails, it's also invalid
    throw new Error(`Invalid URL: ${url}`);
  }
}

/**
 * Check if a URL points to a private/internal network
 * Useful for warning users without blocking the request
 *
 * @param url - The URL to check
 * @returns true if the URL points to a private network
 */
export function isPrivateUrl(url: string | URL): boolean {
  try {
    const parsedUrl = new URL(url);
    return isPrivateHostname(parsedUrl.hostname);
  } catch {
    return false;
  }
}
