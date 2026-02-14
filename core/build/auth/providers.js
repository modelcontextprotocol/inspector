import { generateOAuthStateWithMode } from "./utils.js";
/**
 * Mutable redirect URL provider for TUI/CLI. Caller sets redirectUrl
 * before authenticate(); same URL is used for both normal and guided flows.
 */
export class MutableRedirectUrlProvider {
    redirectUrl = "";
    getRedirectUrl(_mode) {
        return this.redirectUrl;
    }
}
/**
 * Callback navigation handler
 * Invokes the provided callback when navigation is requested.
 * The caller always handles navigation.
 */
export class CallbackNavigation {
    callback;
    authorizationUrl = null;
    constructor(callback) {
        this.callback = callback;
    }
    navigateToAuthorization(authorizationUrl) {
        this.authorizationUrl = authorizationUrl;
        const result = this.callback(authorizationUrl);
        if (result instanceof Promise) {
            void result;
        }
    }
    getAuthorizationUrl() {
        return this.authorizationUrl;
    }
}
/**
 * Console navigation handler
 * Prints the authorization URL to console, optionally invokes an extra callback.
 */
export class ConsoleNavigation extends CallbackNavigation {
    constructor(callback) {
        super((url) => {
            console.log(`Please navigate to: ${url.href}`);
            return callback?.(url);
        });
    }
}
/**
 * Base OAuth client provider
 * Implements common OAuth provider functionality.
 * Use with injected storage, redirect URL provider, and navigation.
 */
export class BaseOAuthClientProvider {
    serverUrl;
    capturedAuthUrl = null;
    eventTarget = null;
    storage;
    redirectUrlProvider;
    navigation;
    clientMetadataUrl;
    mode;
    constructor(serverUrl, oauthConfig, mode = "normal") {
        this.serverUrl = serverUrl;
        this.storage = oauthConfig.storage;
        this.redirectUrlProvider = oauthConfig.redirectUrlProvider;
        this.navigation = oauthConfig.navigation;
        this.clientMetadataUrl = oauthConfig.clientMetadataUrl;
        this.mode = mode;
    }
    /**
     * Set the event target for dispatching oauthAuthorizationRequired events
     */
    setEventTarget(eventTarget) {
        this.eventTarget = eventTarget;
    }
    /**
     * Get the captured authorization URL (for return value)
     */
    getCapturedAuthUrl() {
        return this.capturedAuthUrl;
    }
    /**
     * Clear the captured authorization URL
     */
    clearCapturedAuthUrl() {
        this.capturedAuthUrl = null;
    }
    get scope() {
        return this.storage.getScope(this.serverUrl);
    }
    /** Redirect URL for the current flow (normal or guided). */
    get redirectUrl() {
        return this.redirectUrlProvider.getRedirectUrl(this.mode);
    }
    get redirect_uris() {
        return [this.redirectUrlProvider.getRedirectUrl("normal")];
    }
    get clientMetadata() {
        const metadata = {
            redirect_uris: this.redirect_uris,
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            client_name: "MCP Inspector",
            client_uri: "https://github.com/modelcontextprotocol/inspector",
            scope: this.scope ?? "",
        };
        // Note: clientMetadataUrl for CIMD mode is passed to registerClient() directly,
        // not as part of clientMetadata. The SDK handles CIMD separately.
        return metadata;
    }
    state() {
        return generateOAuthStateWithMode(this.mode);
    }
    async clientInformation() {
        // Try preregistered first, then dynamically registered
        const preregistered = await this.storage.getClientInformation(this.serverUrl, true);
        if (preregistered) {
            return preregistered;
        }
        return await this.storage.getClientInformation(this.serverUrl, false);
    }
    async saveClientInformation(clientInformation) {
        await this.storage.saveClientInformation(this.serverUrl, clientInformation);
    }
    async saveScope(scope) {
        await this.storage.saveScope(this.serverUrl, scope);
    }
    async savePreregisteredClientInformation(clientInformation) {
        await this.storage.savePreregisteredClientInformation(this.serverUrl, clientInformation);
    }
    async tokens() {
        return await this.storage.getTokens(this.serverUrl);
    }
    async saveTokens(tokens) {
        await this.storage.saveTokens(this.serverUrl, tokens);
    }
    redirectToAuthorization(authorizationUrl) {
        // Capture URL for return value
        this.capturedAuthUrl = authorizationUrl;
        // Dispatch event if event target is set
        if (this.eventTarget) {
            this.eventTarget.dispatchEvent(new CustomEvent("oauthAuthorizationRequired", {
                detail: { url: authorizationUrl },
            }));
        }
        // Original navigation behavior
        this.navigation.navigateToAuthorization(authorizationUrl);
    }
    async saveCodeVerifier(codeVerifier) {
        await this.storage.saveCodeVerifier(this.serverUrl, codeVerifier);
    }
    codeVerifier() {
        const verifier = this.storage.getCodeVerifier(this.serverUrl);
        if (!verifier) {
            throw new Error("No code verifier saved for session");
        }
        return verifier;
    }
    clear() {
        this.storage.clear(this.serverUrl);
    }
    getServerMetadata() {
        return this.storage.getServerMetadata(this.serverUrl);
    }
    async saveServerMetadata(metadata) {
        await this.storage.saveServerMetadata(this.serverUrl, metadata);
    }
}
//# sourceMappingURL=providers.js.map