import type { OAuthNavigationCallback } from "../providers.js";
import { CallbackNavigation, BaseOAuthClientProvider } from "../providers.js";
export type { OAuthNavigationCallback } from "../providers.js";
/**
 * Browser navigation handler
 * Redirects the browser window to the authorization URL, optionally invokes an
 * extra callback.
 */
export declare class BrowserNavigation extends CallbackNavigation {
    constructor(callback?: OAuthNavigationCallback);
}
/**
 * Browser OAuth client provider
 * Uses sessionStorage directly (for web client reference)
 */
export declare class BrowserOAuthClientProvider extends BaseOAuthClientProvider {
    constructor(serverUrl: string);
}
//# sourceMappingURL=providers.d.ts.map