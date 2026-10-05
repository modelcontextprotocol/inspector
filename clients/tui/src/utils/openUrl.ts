import { openUrl as openInBrowser } from "@inspector/core/node/openUrl.js";

/** The note the TUI shows when it could not launch a browser for `href`. */
export function browserOpenFailedMessage(href: string): string {
  return `Could not open a browser automatically. Open this URL manually to authorize: ${href}`;
}

/**
 * Open the OAuth authorization page in the user's default browser, never
 * rejecting.
 *
 * The launch goes through core's shared `openUrl`, which turns a spawn
 * failure (the opener binary missing from `PATH`) into a rejection instead of
 * an unlistened `'error'` event that crashed the TUI mid-flow (#2533). This
 * wrapper then owns that rejection: `CallbackNavigation` discards the
 * callback's promise, so a rejection escaping here would be unhandled and
 * crash the process just the same. On failure it hands `onFailure` the
 * "open the URL manually" note, which App renders on the Auth tab.
 *
 * @param url - URL to open (string or URL)
 * @param onFailure - receives the fallback note when the browser did not open
 */
export async function openUrl(
  url: string | URL,
  onFailure?: (message: string) => void,
): Promise<void> {
  const href = typeof url === "string" ? url : url.href;
  try {
    await openInBrowser(href);
  } catch {
    onFailure?.(browserOpenFailedMessage(href));
  }
}
