import { CallbackNavigation, BaseOAuthClientProvider } from "../providers.js";
import { BrowserOAuthStorage } from "./storage.js";
/**
 * Browser navigation handler
 * Redirects the browser window to the authorization URL, optionally invokes an
 * extra callback.
 */
export class BrowserNavigation extends CallbackNavigation {
    constructor(callback) {
        super((url) => {
            if (typeof window === "undefined") {
                throw new Error("BrowserNavigation requires browser environment");
            }
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
    constructor(serverUrl) {
        if (typeof window === "undefined") {
            throw new Error("BrowserOAuthClientProvider requires browser environment");
        }
        const storage = new BrowserOAuthStorage();
        const redirectUrlProvider = {
            getRedirectUrl: (_mode) => `${window.location.origin}/oauth/callback`,
        };
        const navigation = new BrowserNavigation();
        super(serverUrl, { storage, redirectUrlProvider, navigation }, "normal");
    }
}
//# sourceMappingURL=providers.js.map