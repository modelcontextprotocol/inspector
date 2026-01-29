import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthStorage } from "./storage.js";
import { generateOAuthState } from "./utils.js";
import { NodeOAuthStorage } from "./storage-node.js";

/**
 * Redirect URL provider interface
 * Returns redirect URLs based on the provider's mode (normal or guided)
 */
export interface RedirectUrlProvider {
  /**
   * Get the redirect URL for the current mode
   * Normal mode returns /oauth/callback
   * Guided mode returns /oauth/callback/guided
   */
  getRedirectUrl(): string;
}

/**
 * Browser redirect URL provider
 * Returns URLs based on window.location.origin
 */
export class BrowserRedirectUrlProvider implements RedirectUrlProvider {
  constructor(private mode: "normal" | "guided" = "normal") {}

  getRedirectUrl(): string {
    if (typeof window === "undefined") {
      throw new Error(
        "BrowserRedirectUrlProvider requires browser environment",
      );
    }
    return this.mode === "guided"
      ? `${window.location.origin}/oauth/callback/guided`
      : `${window.location.origin}/oauth/callback`;
  }
}

/**
 * Local server redirect URL provider
 * Returns URLs based on a local server port
 */
export class LocalServerRedirectUrlProvider implements RedirectUrlProvider {
  constructor(
    private port: number,
    private mode: "normal" | "guided" = "normal",
  ) {}

  /**
   * Get the port number (public for creating new instances with different modes)
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get the current mode
   */
  getMode(): "normal" | "guided" {
    return this.mode;
  }

  /**
   * Create a new instance with a different mode
   */
  clone(mode: "normal" | "guided"): LocalServerRedirectUrlProvider {
    return new LocalServerRedirectUrlProvider(this.port, mode);
  }

  getRedirectUrl(): string {
    return this.mode === "guided"
      ? `http://localhost:${this.port}/oauth/callback/guided`
      : `http://localhost:${this.port}/oauth/callback`;
  }
}

/**
 * Manual redirect URL provider
 * Returns URLs based on a provided base URL
 */
export class ManualRedirectUrlProvider implements RedirectUrlProvider {
  constructor(
    private baseUrl: string,
    private mode: "normal" | "guided" = "normal",
  ) {}

  /**
   * Get the base URL (public for creating new instances with different modes)
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Get the current mode
   */
  getMode(): "normal" | "guided" {
    return this.mode;
  }

  /**
   * Create a new instance with a different mode
   */
  clone(mode: "normal" | "guided"): ManualRedirectUrlProvider {
    return new ManualRedirectUrlProvider(this.baseUrl, mode);
  }

  getRedirectUrl(): string {
    const base = this.baseUrl.endsWith("/")
      ? this.baseUrl.slice(0, -1)
      : this.baseUrl;
    // If the base URL already contains /oauth/callback, return it as-is
    if (base.includes("/oauth/callback")) {
      return base;
    }
    return this.mode === "guided"
      ? `${base}/oauth/callback/guided`
      : `${base}/oauth/callback`;
  }
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

/**
 * Browser navigation handler
 * Redirects the browser window to the authorization URL
 */
export class BrowserNavigation implements OAuthNavigation {
  navigateToAuthorization(authorizationUrl: URL): void {
    if (typeof window === "undefined") {
      throw new Error("BrowserNavigation requires browser environment");
    }
    window.location.href = authorizationUrl.href;
  }
}

/**
 * Console navigation handler
 * Prints the authorization URL to console
 */
export class ConsoleNavigation implements OAuthNavigation {
  navigateToAuthorization(authorizationUrl: URL): void {
    console.log(`Please navigate to: ${authorizationUrl.href}`);
  }
}

/**
 * Callback navigation handler
 * Stores the authorization URL for later retrieval (e.g., for manual entry)
 */
export class CallbackNavigation implements OAuthNavigation {
  private authorizationUrl: URL | null = null;

  navigateToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl;
  }

  getAuthorizationUrl(): URL | null {
    return this.authorizationUrl;
  }
}

/**
 * Base OAuth client provider
 * Implements common OAuth provider functionality
 */
export abstract class BaseOAuthClientProvider implements OAuthClientProvider {
  private capturedAuthUrl: URL | null = null;
  private eventTarget: EventTarget | null = null;

  constructor(
    protected serverUrl: string,
    protected storage: OAuthStorage,
    protected redirectUrlProvider: RedirectUrlProvider,
    protected navigation: OAuthNavigation,
    public clientMetadataUrl?: string,
  ) {}

  /**
   * Set the event target for dispatching oauthAuthorizationRequired events
   */
  setEventTarget(eventTarget: EventTarget): void {
    this.eventTarget = eventTarget;
  }

  /**
   * Get the captured authorization URL (for return value)
   */
  getCapturedAuthUrl(): URL | null {
    return this.capturedAuthUrl;
  }

  /**
   * Clear the captured authorization URL
   */
  clearCapturedAuthUrl(): void {
    this.capturedAuthUrl = null;
  }

  get scope(): string | undefined {
    return this.storage.getScope(this.serverUrl);
  }

  get redirectUrl(): string {
    return this.redirectUrlProvider.getRedirectUrl();
  }

  get redirect_uris(): string[] {
    // Register both normal and guided redirect URLs
    // The provider's mode determines which is used for the current flow
    const normalUrl = this.getNormalRedirectUrl();
    const guidedUrl = this.getGuidedRedirectUrl();

    // Remove duplicates if they're the same
    return [...new Set([normalUrl, guidedUrl])];
  }

  /**
   * Get normal redirect URL (for normal mode)
   */
  protected getNormalRedirectUrl(): string {
    if (this.redirectUrlProvider instanceof BrowserRedirectUrlProvider) {
      return new BrowserRedirectUrlProvider("normal").getRedirectUrl();
    } else if (
      this.redirectUrlProvider instanceof LocalServerRedirectUrlProvider
    ) {
      return this.redirectUrlProvider.clone("normal").getRedirectUrl();
    } else if (this.redirectUrlProvider instanceof ManualRedirectUrlProvider) {
      return this.redirectUrlProvider.clone("normal").getRedirectUrl();
    }
    return this.redirectUrlProvider.getRedirectUrl();
  }

  /**
   * Get guided redirect URL (for guided mode)
   */
  protected getGuidedRedirectUrl(): string {
    if (this.redirectUrlProvider instanceof BrowserRedirectUrlProvider) {
      return new BrowserRedirectUrlProvider("guided").getRedirectUrl();
    } else if (
      this.redirectUrlProvider instanceof LocalServerRedirectUrlProvider
    ) {
      return this.redirectUrlProvider.clone("guided").getRedirectUrl();
    } else if (this.redirectUrlProvider instanceof ManualRedirectUrlProvider) {
      return this.redirectUrlProvider.clone("guided").getRedirectUrl();
    }
    return this.redirectUrlProvider.getRedirectUrl();
  }

  get clientMetadata(): OAuthClientMetadata {
    const metadata: OAuthClientMetadata = {
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

  state(): string | Promise<string> {
    return generateOAuthState();
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    // Try preregistered first, then dynamically registered
    const preregistered = await this.storage.getClientInformation(
      this.serverUrl,
      true,
    );
    if (preregistered) {
      return preregistered;
    }
    return await this.storage.getClientInformation(this.serverUrl, false);
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformation,
  ): Promise<void> {
    await this.storage.saveClientInformation(this.serverUrl, clientInformation);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return await this.storage.getTokens(this.serverUrl);
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.storage.saveTokens(this.serverUrl, tokens);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    // Capture URL for return value
    this.capturedAuthUrl = authorizationUrl;

    // Dispatch event if event target is set
    if (this.eventTarget) {
      this.eventTarget.dispatchEvent(
        new CustomEvent("oauthAuthorizationRequired", {
          detail: { url: authorizationUrl },
        }),
      );
    }

    // Original navigation behavior
    this.navigation.navigateToAuthorization(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.storage.saveCodeVerifier(this.serverUrl, codeVerifier);
  }

  codeVerifier(): string {
    const verifier = this.storage.getCodeVerifier(this.serverUrl);
    if (!verifier) {
      throw new Error("No code verifier saved for session");
    }
    return verifier;
  }

  clear(): void {
    this.storage.clear(this.serverUrl);
  }
}

/**
 * Browser OAuth client provider
 * Uses sessionStorage directly (for web client reference)
 */
export class BrowserOAuthClientProvider extends BaseOAuthClientProvider {
  constructor(serverUrl: string) {
    // Import browser storage dynamically to avoid Node.js dependency
    const { BrowserOAuthStorage } = require("./storage-browser.js");
    const storage = new BrowserOAuthStorage();
    const redirectUrlProvider = new BrowserRedirectUrlProvider("normal");
    const navigation = new BrowserNavigation();

    super(serverUrl, storage, redirectUrlProvider, navigation);
  }
}

/**
 * Node.js OAuth client provider
 * Uses Zustand store with file persistence (for InspectorClient/CLI/TUI)
 */
export class NodeOAuthClientProvider extends BaseOAuthClientProvider {
  constructor(
    serverUrl: string,
    redirectUrlProvider: RedirectUrlProvider,
    navigation: OAuthNavigation,
    clientMetadataUrl?: string,
    storagePath?: string,
  ) {
    const storage = new NodeOAuthStorage(storagePath);

    super(
      serverUrl,
      storage,
      redirectUrlProvider,
      navigation,
      clientMetadataUrl,
    );
  }

  /**
   * Get server metadata (for guided mode)
   */
  getServerMetadata(): OAuthMetadata | null {
    return this.storage.getServerMetadata(this.serverUrl);
  }

  /**
   * Save server metadata (for guided mode)
   */
  async saveServerMetadata(metadata: OAuthMetadata): Promise<void> {
    await this.storage.saveServerMetadata(this.serverUrl, metadata);
  }
}

/**
 * Guided Node.js OAuth client provider
 * Extends NodeOAuthClientProvider with guided-specific redirect URL
 */
export class GuidedNodeOAuthClientProvider extends NodeOAuthClientProvider {
  constructor(
    serverUrl: string,
    redirectUrlProvider: RedirectUrlProvider,
    navigation: OAuthNavigation,
    clientMetadataUrl?: string,
    storagePath?: string,
  ) {
    // Create a guided-mode redirect URL provider
    const guidedRedirectProvider =
      redirectUrlProvider instanceof LocalServerRedirectUrlProvider
        ? redirectUrlProvider.clone("guided")
        : redirectUrlProvider instanceof ManualRedirectUrlProvider
          ? redirectUrlProvider.clone("guided")
          : redirectUrlProvider;

    super(
      serverUrl,
      guidedRedirectProvider,
      navigation,
      clientMetadataUrl,
      storagePath,
    );
  }

  get redirectUrl(): string {
    // Override to use guided redirect URL
    return this.redirectUrlProvider.getRedirectUrl();
  }
}
