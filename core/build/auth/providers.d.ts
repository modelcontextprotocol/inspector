import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformation, OAuthClientMetadata, OAuthTokens, OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthStorage } from "./storage.js";
/**
 * Redirect URL provider. Returns the redirect URL for the requested mode.
 * Caller populates the URLs before authenticate() (e.g. from callback server).
 */
export interface RedirectUrlProvider {
    getRedirectUrl(mode: "normal" | "guided"): string;
}
/**
 * Mutable redirect URL provider for TUI/CLI. Caller sets redirectUrl
 * before authenticate(); same URL is used for both normal and guided flows.
 */
export declare class MutableRedirectUrlProvider implements RedirectUrlProvider {
    redirectUrl: string;
    getRedirectUrl(_mode: "normal" | "guided"): string;
}
/**
 * Navigation handler interface
 * Handles navigation to authorization URLs
 */
export interface OAuthNavigation {
    /**
     * Navigate to the authorization URL
     * @param authorizationUrl - The OAuth authorization URL
     */
    navigateToAuthorization(authorizationUrl: URL): void;
}
export type OAuthNavigationCallback = (authorizationUrl: URL) => void | Promise<void>;
/**
 * Callback navigation handler
 * Invokes the provided callback when navigation is requested.
 * The caller always handles navigation.
 */
export declare class CallbackNavigation implements OAuthNavigation {
    private callback;
    private authorizationUrl;
    constructor(callback: OAuthNavigationCallback);
    navigateToAuthorization(authorizationUrl: URL): void;
    getAuthorizationUrl(): URL | null;
}
/**
 * Console navigation handler
 * Prints the authorization URL to console, optionally invokes an extra callback.
 */
export declare class ConsoleNavigation extends CallbackNavigation {
    constructor(callback?: OAuthNavigationCallback);
}
/**
 * Config passed to BaseOAuthClientProvider. Provider assigns to members and
 * accesses as needed.
 */
export type OAuthProviderConfig = {
    storage: OAuthStorage;
    redirectUrlProvider: RedirectUrlProvider;
    navigation: OAuthNavigation;
    clientMetadataUrl?: string;
};
/**
 * Base OAuth client provider
 * Implements common OAuth provider functionality.
 * Use with injected storage, redirect URL provider, and navigation.
 */
export declare class BaseOAuthClientProvider implements OAuthClientProvider {
    protected serverUrl: string;
    private capturedAuthUrl;
    private eventTarget;
    protected storage: OAuthStorage;
    protected redirectUrlProvider: RedirectUrlProvider;
    protected navigation: OAuthNavigation;
    clientMetadataUrl?: string;
    protected mode: "normal" | "guided";
    constructor(serverUrl: string, oauthConfig: OAuthProviderConfig, mode?: "normal" | "guided");
    /**
     * Set the event target for dispatching oauthAuthorizationRequired events
     */
    setEventTarget(eventTarget: EventTarget): void;
    /**
     * Get the captured authorization URL (for return value)
     */
    getCapturedAuthUrl(): URL | null;
    /**
     * Clear the captured authorization URL
     */
    clearCapturedAuthUrl(): void;
    get scope(): string | undefined;
    /** Redirect URL for the current flow (normal or guided). */
    get redirectUrl(): string;
    get redirect_uris(): string[];
    get clientMetadata(): OAuthClientMetadata;
    state(): string | Promise<string>;
    clientInformation(): Promise<OAuthClientInformation | undefined>;
    saveClientInformation(clientInformation: OAuthClientInformation): Promise<void>;
    saveScope(scope: string | undefined): Promise<void>;
    savePreregisteredClientInformation(clientInformation: OAuthClientInformation): Promise<void>;
    tokens(): Promise<OAuthTokens | undefined>;
    saveTokens(tokens: OAuthTokens): Promise<void>;
    redirectToAuthorization(authorizationUrl: URL): void;
    saveCodeVerifier(codeVerifier: string): Promise<void>;
    codeVerifier(): string;
    clear(): void;
    getServerMetadata(): OAuthMetadata | null;
    saveServerMetadata(metadata: OAuthMetadata): Promise<void>;
}
//# sourceMappingURL=providers.d.ts.map