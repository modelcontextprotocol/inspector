import type {
  RedirectUrlProvider,
  OAuthNavigationCallback,
} from "../providers.js";
import { CallbackNavigation, BaseOAuthClientProvider } from "../providers.js";
import { getBrowserOAuthStorage } from "./storage.js";

export type { OAuthNavigationCallback } from "../providers.js";

/**
 * Browser navigation handler
 * Redirects the browser window to the authorization URL.
 *
 * `beforeNavigate` runs **synchronously, immediately before** the
 * `window.location.href` assignment. It is the last point at which code can
 * run on the soon-to-unload document, so consumers that need to flush state
 * across the OAuth redirect (e.g. persisting the Network log via a `keepalive`
 * request) must do it here — a request dispatched synchronously before
 * navigation survives the unload, whereas one fired from a later microtask
 * (after `auth()` returns) is dropped when the document tears down.
 *
 * `callback` runs after navigation is requested; kept for backwards
 * compatibility with callers that only need a post-redirect notification.
 */
export class BrowserNavigation extends CallbackNavigation {
  constructor(
    callback?: OAuthNavigationCallback,
    beforeNavigate?: (authorizationUrl: URL) => void,
  ) {
    super((url) => {
      if (typeof window === "undefined") {
        throw new Error("BrowserNavigation requires browser environment");
      }
      beforeNavigate?.(url);
      window.location.href = url.href;
      return callback?.(url);
    });
  }
}

/**
 * Browser OAuth client provider
 * Uses sessionStorage directly (for web client reference)
 */
export class BrowserOAuthClientProvider extends BaseOAuthClientProvider {
  constructor(serverUrl: string) {
    if (typeof window === "undefined") {
      throw new Error(
        "BrowserOAuthClientProvider requires browser environment",
      );
    }
    const storage = getBrowserOAuthStorage();
    const redirectUrlProvider: RedirectUrlProvider = {
      getRedirectUrl: () => `${window.location.origin}/oauth/callback`,
    };
    const navigation = new BrowserNavigation();

    super(serverUrl, { storage, redirectUrlProvider, navigation }, "quick");
  }
}
