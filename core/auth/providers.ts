import type {
  OAuthClientProvider,
  OAuthClientInformationContext,
} from "@modelcontextprotocol/client";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
  OAuthMetadata,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/client";
import type { OAuthStorage, SaveClientInformationOptions } from "./storage.js";
import { generateOAuthState } from "./utils.js";

/**
 * Redirect URL provider. Returns the redirect URL for OAuth flows.
 * Caller populates the URL before authenticate() (e.g. from callback server).
 */
export interface RedirectUrlProvider {
  getRedirectUrl(): string;
}

/**
 * Mutable redirect URL provider for TUI/CLI. Caller sets redirectUrl
 * before authenticate().
 */
export class MutableRedirectUrlProvider implements RedirectUrlProvider {
  redirectUrl = "";

  getRedirectUrl(): string {
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
  private callback: OAuthNavigationCallback;

  constructor(callback: OAuthNavigationCallback) {
    this.callback = callback;
  }

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
  private suppressAuthorizationNavigation = false;
  /** Cached after {@link prepareForAuth} for sync SDK `clientMetadata.scope`. */
  private cachedScope: string | undefined;

  protected serverUrl: string;
  protected storage: OAuthStorage;
  protected redirectUrlProvider: RedirectUrlProvider;
  protected navigation: OAuthNavigation;
  public clientMetadataUrl?: string;

  constructor(serverUrl: string, oauthConfig: OAuthProviderConfig) {
    this.serverUrl = serverUrl;
    this.storage = oauthConfig.storage;
    this.redirectUrlProvider = oauthConfig.redirectUrlProvider;
    this.navigation = oauthConfig.navigation;
    this.clientMetadataUrl = oauthConfig.clientMetadataUrl;
  }

  /**
   * Load persisted scope into {@link cachedScope} before SDK `auth()` (which
   * reads {@link clientMetadata.scope} synchronously).
   */
  async prepareForAuth(): Promise<void> {
    this.cachedScope = await this.storage.getScope(this.serverUrl);
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

  /** Capture authorize URL without navigating (step-up confirmation modal). */
  setSuppressAuthorizationNavigation(suppress: boolean): void {
    this.suppressAuthorizationNavigation = suppress;
  }

  get scope(): string | undefined {
    return this.cachedScope;
  }

  get redirectUrl(): string {
    return this.redirectUrlProvider.getRedirectUrl();
  }

  get redirect_uris(): string[] {
    return [this.redirectUrl];
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
      // SEP-837: the Inspector is a locally-hosted app reached over localhost, so
      // it registers as a native client. OIDC-flavored ASes default an omitted
      // `application_type` to `"web"`, which forbids loopback redirect URIs and
      // rejects DCR. (The SDK also infers `"native"` from loopback `redirect_uris`;
      // declaring it explicitly keeps the value visible and correct even when the
      // redirect host is not itself a loopback literal.)
      application_type: "native",
    };

    // Note: clientMetadataUrl for CIMD mode is passed to registerClient() directly,
    // not as part of clientMetadata. The SDK handles CIMD separately.

    return metadata;
  }

  state(): string | Promise<string> {
    return generateOAuthState();
  }

  async clientInformation(
    ctx?: OAuthClientInformationContext,
  ): Promise<OAuthClientInformation | undefined> {
    // Try preregistered (static, issuer-independent) first, then the per-issuer
    // dynamic registration (SEP-2352 — keyed by `ctx.issuer`).
    const preregistered = await this.storage.getClientInformation(
      this.serverUrl,
      true,
    );
    if (preregistered) {
      return preregistered;
    }
    return await this.storage.getClientInformation(
      this.serverUrl,
      false,
      ctx?.issuer,
    );
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformation,
    // SDK v2's `OAuthClientProvider.saveClientInformation` passes an
    // `OAuthClientInformationContext` ({ issuer }); our own DCR/CIMD callers
    // pass `SaveClientInformationOptions` ({ registrationKind }). Accept either
    // and read whichever keys are present: the SDK supplies `issuer` (SEP-2352
    // per-AS keying) and defaults registration kind to DCR; our callers supply
    // the registration kind and no issuer yet.
    options?: SaveClientInformationOptions | OAuthClientInformationContext,
  ): Promise<void> {
    const registrationKind =
      options && "registrationKind" in options
        ? options.registrationKind
        : "dcr";
    const issuer = options && "issuer" in options ? options.issuer : undefined;
    await this.storage.saveClientInformation(
      this.serverUrl,
      clientInformation,
      {
        registrationKind,
        issuer,
      },
    );
  }

  async saveScope(scope: string | undefined): Promise<void> {
    await this.storage.saveScope(this.serverUrl, scope);
    this.cachedScope = scope;
  }

  async savePreregisteredClientInformation(
    clientInformation: OAuthClientInformation,
  ): Promise<void> {
    await this.storage.savePreregisteredClientInformation(
      this.serverUrl,
      clientInformation,
    );
  }

  async tokens(
    ctx?: OAuthClientInformationContext,
  ): Promise<OAuthTokens | undefined> {
    return await this.storage.getTokens(this.serverUrl, ctx?.issuer);
  }

  async saveTokens(
    tokens: OAuthTokens,
    ctx?: OAuthClientInformationContext,
  ): Promise<void> {
    await this.storage.saveTokens(this.serverUrl, tokens, {
      issuer: ctx?.issuer,
    });
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    // Capture URL for return value
    this.capturedAuthUrl = authorizationUrl;

    if (!this.suppressAuthorizationNavigation) {
      if (this.eventTarget) {
        this.eventTarget.dispatchEvent(
          new CustomEvent("oauthAuthorizationRequired", {
            detail: { url: authorizationUrl },
          }),
        );
      }
      this.navigation.navigateToAuthorization(authorizationUrl);
    }
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.storage.saveCodeVerifier(this.serverUrl, codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    const verifier = await this.storage.getCodeVerifier(this.serverUrl);
    if (!verifier) {
      throw new Error("No code verifier saved for session");
    }
    return verifier;
  }

  async clear(): Promise<void> {
    await this.storage.clear(this.serverUrl);
  }

  async getServerMetadata(): Promise<OAuthMetadata | null> {
    return this.storage.getServerMetadata(this.serverUrl);
  }

  async saveServerMetadata(metadata: OAuthMetadata): Promise<void> {
    await this.storage.saveServerMetadata(this.serverUrl, metadata);
  }

  /**
   * SEP-2352 discovery-state round-trip. The SDK persists RFC 9728/8414 discovery
   * here (alongside the code verifier) so that on the authorization-code callback
   * leg it can compare the resolved AS `issuer` against the one recorded at
   * redirect time and reject a mismatch (`AuthorizationServerMismatchError`).
   * Without these two methods the SDK only `console.warn`s and the binding check
   * is inactive.
   */
  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.storage.saveDiscoveryState(this.serverUrl, state);
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return this.storage.getDiscoveryState(this.serverUrl);
  }

  /**
   * SEP-2352 credential invalidation. The SDK calls this to drop credentials the
   * server has rejected; hosts also call `'discovery'` on repeated 401s so a
   * changed `authorization_servers` list is re-fetched.
   */
  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    switch (scope) {
      case "all":
        await this.storage.clear(this.serverUrl);
        return;
      case "client":
        await this.storage.clearClientInformation(this.serverUrl);
        return;
      case "tokens":
        await this.storage.clearTokens(this.serverUrl);
        return;
      case "verifier":
        await this.storage.clearCodeVerifier(this.serverUrl);
        return;
      case "discovery":
        await this.storage.clearDiscoveryState(this.serverUrl);
        return;
    }
  }
}
