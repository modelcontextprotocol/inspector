import open from "open";

/**
 * Opens a URL in the user's default browser.
 * Used when handling oauthAuthorizationRequired to launch the OAuth authorization page.
 *
 * @param url - URL to open (string or URL)
 * @returns Promise that resolves when the opener completes (or rejects on error)
 */
export async function openUrl(url: string | URL): Promise<void> {
  await open(typeof url === "string" ? url : url.href);
}
