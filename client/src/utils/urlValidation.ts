/**
 * Validates that a URL is safe for redirection.
 * Only allows HTTP and HTTPS protocols to prevent XSS attacks.
 *
 * @param url - The URL string to validate
 * @throws Error if the URL has an unsafe protocol
 */
export function validateRedirectUrl(url: string | URL): void {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Authorization URL must be HTTP or HTTPS");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Authorization URL must be HTTP or HTTPS"
    ) {
      throw error;
    }
    // If URL parsing fails, it's also invalid
    throw new Error(`Invalid URL: ${url}`);
  }
}

/**
 * Parses an absolute HTTP(S) URL, returning its normalized href, or null for
 * anything else (javascript:, data:, file:, relative paths, unparseable input).
 *
 * @param url - The URL string to parse
 */
export function parseHttpUrl(url: string): string | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return null;
  }
  return parsedUrl.href;
}
