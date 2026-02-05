import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthStorage } from "./storage.js";
import { generateOAuthStateWithMode } from "./utils.js";

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
export class MutableRedirectUrlProvider implements RedirectUrlProvider {
  redirectUrl = "";

  getRedirectUrl(_mode: "normal" | "guided"): string {
    return this.redirectUrl;
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

export type OAuthNavigationCallback = (
  authorizationUrl: URL,
) => void | Promise<void>;

/**
 * Callback navigation handler
 * Invokes the provided callback when navigation is requested.
 * The caller always handles navigation.
 */
export class CallbackNavigation implements OAuthNavigation {
  private authorizationUrl: URL | null = null;

  constructor(private callback: OAuthNavigationCallback) {}

  navigateToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl;
    const result = this.callback(authorizationUrl);
    if (result instanceof Promise) {
      void result;
    }
  }

  getAuthorizationUrl(): URL | null {
    return this.authorizationUrl;
  }
}

/**
 * Console navigation handler
 * Prints the authorization URL to console, optionally invokes an extra callback.
 */
export class ConsoleNavigation extends CallbackNavigation {
  constructor(callback?: OAuthNavigationCallback) {
    super((url) => {
      console.log(`Please navigate to: ${url.href}`);
      return callback?.(url);
    });
  }
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
export class BaseOAuthClientProvider implements OAuthClientProvider {
  private capturedAuthUrl: URL | null = null;
  private eventTarget: EventTarget | null = null;

  protected storage: OAuthStorage;
  protected redirectUrlProvider: RedirectUrlProvider;
  protected navigation: OAuthNavigation;
  public clientMetadataUrl?: string;
  protected mode: "normal" | "guided";

  constructor(
    protected serverUrl: string,
    oauthConfig: OAuthProviderConfig,
    mode: "normal" | "guided" = "normal",
  ) {
    this.storage = oauthConfig.storage;
    this.redirectUrlProvider = oauthConfig.redirectUrlProvider;
    this.navigation = oauthConfig.navigation;
    this.clientMetadataUrl = oauthConfig.clientMetadataUrl;
    this.mode = mode;
  }

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

  /** Redirect URL for the current flow (normal or guided). */
  get redirectUrl(): string {
    return this.redirectUrlProvider.getRedirectUrl(this.mode);
  }

  get redirect_uris(): string[] {
    return [this.redirectUrlProvider.getRedirectUrl("normal")];
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
    return generateOAuthStateWithMode(this.mode);
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

  async saveScope(scope: string | undefined): Promise<void> {
    await this.storage.saveScope(this.serverUrl, scope);
  }

  async savePreregisteredClientInformation(
    clientInformation: OAuthClientInformation,
  ): Promise<void> {
    await this.storage.savePreregisteredClientInformation(
      this.serverUrl,
      clientInformation,
    );
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

  getServerMetadata(): OAuthMetadata | null {
    return this.storage.getServerMetadata(this.serverUrl);
  }

  async saveServerMetadata(metadata: OAuthMetadata): Promise<void> {
    await this.storage.saveServerMetadata(this.serverUrl, metadata);
  }
}
