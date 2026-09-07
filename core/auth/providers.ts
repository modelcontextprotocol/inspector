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
import { applyAuthorizationParams } from "./authorizationParams.js";
import { scopeForDeclinedRefreshGrant } from "./scopes.js";

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
  /**
   * Per-server custom authorization-request parameters (#2018), merged into the
   * finished authorize URL in {@link BaseOAuthClientProvider.redirectToAuthorization}.
   * Reserved (protocol-critical) keys are dropped with a warning — see
   * `authorizationParams.ts`. Authorization request only; the token request is
   * unaffected.
   */
  authorizationParams?: Record<string, string>;
  /**
   * Whether to declare the `refresh_token` grant in the registered client
   * metadata (#2068). Defaults to `true`; set `false` to register (and
   * authorize) as an authorization-code-only client.
   *
   * This is not merely cosmetic. The SDK's `determineScope()` appends
   * `offline_access` to the effective scope whenever the authorization server
   * advertises it **and** the client metadata declares `refresh_token`, and
   * `startAuthorization()` then appends `prompt=consent` whenever
   * `offline_access` is in scope. Against Microsoft Entra ID, that forced
   * consent prompt routes a non-admin user into the admin-consent workflow and
   * fails with `AADSTS90094` even after a tenant admin has consented.
   *
   * It removes that *automatic* augmentation only. `startAuthorization()` reads
   * the scope, never `grant_types`, so an `offline_access` the caller passed in
   * `scope` — or one the resource advertises when `scope` is unset, which
   * `determineScope` falls back to — still produces the prompt. This is not on
   * its own a guarantee that `prompt=consent` is absent.
   */
  requestRefreshToken?: boolean;
  /**
   * The scope configured for this server (mcp.json / Server Settings), as
   * distinct from the scope carried in OAuth storage after a previous grant.
   *
   * Used only to decide whether an `offline_access` in the effective scope was
   * *asked for* or merely inherited — see {@link scopeForDeclinedRefreshGrant}.
   * An explicitly configured one is honored; an inherited one is dropped from
   * the request when {@link requestRefreshToken} is false. (#2068)
   */
  configuredScope?: string;
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
  /** Custom authorization-request parameters (#2018). Authorize URL only. */
  protected authorizationParams?: Record<string, string>;
  /** Declare the `refresh_token` grant in {@link clientMetadata} (#2068). */
  protected requestRefreshToken: boolean;
  /** Server-configured scope, for the #2068 `offline_access` distinction. */
  protected configuredScope?: string;

  constructor(serverUrl: string, oauthConfig: OAuthProviderConfig) {
    this.serverUrl = serverUrl;
    this.storage = oauthConfig.storage;
    this.redirectUrlProvider = oauthConfig.redirectUrlProvider;
    this.navigation = oauthConfig.navigation;
    this.clientMetadataUrl = oauthConfig.clientMetadataUrl;
    this.authorizationParams = oauthConfig.authorizationParams;
    this.requestRefreshToken = oauthConfig.requestRefreshToken ?? true;
    this.configuredScope = oauthConfig.configuredScope;
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
    // #2068: filter at the point of *request*, not in storage. Covers the two
    // readers that go through this getter — `clientMetadata.scope` below, and
    // the `scope:` argument `OAuthManager.authenticate` hands to the SDK.
    //
    // It is NOT the only request path: mid-session `insufficient_scope` step-up
    // builds its union from raw storage and passes it to `mcpAuth` directly,
    // never reading this getter. `OAuthManager.handleAuthChallenge` applies the
    // same filter there. Both call `scopeForDeclinedRefreshGrant`, so the rule
    // lives in one place even though it has to be applied twice.
    if (!this.requestRefreshToken) {
      return scopeForDeclinedRefreshGrant(
        this.cachedScope,
        this.configuredScope,
      );
    }
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
      // #2068: `refresh_token` is declared by default, and dropped when the
      // server's "Request refresh token" setting is off — which stops the SDK
      // *adding* `offline_access` (and so the `prompt=consent` it forces). It
      // does not remove an `offline_access` that reaches the scope another way.
      // See `OAuthProviderConfig.requestRefreshToken`.
      grant_types: this.requestRefreshToken
        ? ["authorization_code", "refresh_token"]
        : ["authorization_code"],
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
    // and read whichever keys are present. The SDK supplies `issuer` (SEP-2352
    // per-AS keying) and never a kind, so `resolveSdkRegistrationKind` recovers
    // one. Our own callers always supply the kind, and supply the `issuer` too
    // when they know it — `ensureCimdClientRegistration` does, having just
    // discovered it; the unkeyed slot is only for the case where AS metadata
    // carried no `issuer` at all.
    options?: SaveClientInformationOptions | OAuthClientInformationContext,
  ): Promise<void> {
    const issuer = options && "issuer" in options ? options.issuer : undefined;
    const registrationKind =
      options && "registrationKind" in options
        ? options.registrationKind
        : await this.resolveSdkRegistrationKind(clientInformation, issuer);
    await this.storage.saveClientInformation(
      this.serverUrl,
      clientInformation,
      {
        registrationKind,
        issuer,
      },
    );
  }

  /**
   * Resolve the registration kind for a save that carries no explicit one — that
   * is, one the SDK made. SDK v2's `saveClientInformation` contract passes only
   * `{ issuer }`, so the mechanism cannot be handed to us; treating every such
   * save as DCR is what relabeled a CIMD registration `Dynamic (DCR)` in
   * Connection Info the moment the SDK bound it to an issuer (#2242).
   *
   * The claim is deliberately narrow — three conditions must all hold, and the
   * decisive one is a fact *we recorded about this authorization server*, not an
   * inference about what it returned:
   *
   * 1. CIMD is configured for this connection right now, and
   * 2. the incoming `client_id` is exactly that metadata-document URL, and
   * 3. `ensureCimdClientRegistration` recorded that same URL as the CIMD marker
   *    **for this issuer**, having read `client_id_metadata_document_supported`
   *    from *that* AS's own metadata.
   *
   * RFC 7591 §3.2 makes a dynamically issued `client_id` opaque, so a client may
   * not assume its format — which is why (2) is not load-bearing on its own. For
   * a `registerClient` result to be mislabeled here, the AS would have to mint an
   * identifier byte-identical to the HTTPS URL we configured *and* be an AS that
   * currently advertises CIMD and dynamically registered anyway. Anything else —
   * a fresh DCR, a different id, CIMD switched off, an AS that does not advertise
   * CIMD — falls through to `"dcr"`.
   *
   * ⚠️ (3) reads the **marker**, not the stored registration kind, and the two
   * differ in exactly one place that matters: `invalidateCredentials("client")`
   * clears the credential and its kind, and SDK v2 `auth()` calls it on an
   * `invalid_client` / `unauthorized_client` response before retrying. The
   * retry's URL-based client-ID save would then find no kind and be recorded as
   * DCR. The marker describes the AS rather than the credential, so it survives
   * that clear (#2242, Copilot).
   *
   * ⚠️ (3) is issuer-scoped with no fallback to the server's active issuer. A
   * second AS behind one resource is a separate determination: it may not support
   * CIMD and may register dynamically, and RFC 7591 permits it to mint the very
   * URL the first AS uses as its CIMD `client_id`.
   */
  private async resolveSdkRegistrationKind(
    clientInformation: OAuthClientInformation,
    issuer: string | undefined,
  ): Promise<SaveClientInformationOptions["registrationKind"]> {
    const clientMetadataUrl = this.clientMetadataUrl?.trim();
    if (
      !clientMetadataUrl ||
      clientInformation.client_id !== clientMetadataUrl
    ) {
      return "dcr";
    }
    const marker = await this.storage.getCimdClientMetadataUrl(
      this.serverUrl,
      issuer,
    );
    return marker === clientMetadataUrl ? "cimd" : "dcr";
  }

  /** @see OAuthStorage.getCimdClientMetadataUrl */
  async cimdClientMetadataUrl(issuer?: string): Promise<string | undefined> {
    return await this.storage.getCimdClientMetadataUrl(this.serverUrl, issuer);
  }

  /** @see OAuthStorage.saveCimdClientMetadataUrl */
  async saveCimdClientMetadataUrl(
    issuer: string,
    clientMetadataUrl: string | undefined,
  ): Promise<void> {
    await this.storage.saveCimdClientMetadataUrl(
      this.serverUrl,
      issuer,
      clientMetadataUrl,
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
    // #2018: the SDK builds the authorize URL and offers no hook for extra
    // parameters, so the per-server ones are merged here — the one seam that
    // sees the finished URL before navigation. Everything downstream (the
    // captured URL used by the step-up modal, the event, the navigation) uses
    // the merged URL so all three agree on what was actually requested.
    this.performAuthorizationRedirect(
      applyAuthorizationParams(authorizationUrl, this.authorizationParams),
    );
  }

  /**
   * Redirect to an authorize URL belonging to a **different** authorization
   * server than the one this provider was configured for, so the per-server
   * custom parameters (#2018) MUST NOT be applied.
   *
   * The only caller is the enterprise-managed (EMA) transport provider, which
   * discards the resource AS URL and sends the user to the enterprise IdP
   * instead. Parameters a user configured for their MCP server's authorization
   * server — a `kc_idp_hint`, an `audience` — are meaningless and potentially
   * flow-breaking on the IdP's, and appending them there would leak per-server
   * config across an authorization-server boundary.
   */
  redirectToExternalAuthorization(authorizationUrl: URL): void {
    this.performAuthorizationRedirect(authorizationUrl);
  }

  /** Capture, announce, and navigate to a finished authorize URL. */
  private performAuthorizationRedirect(authorizationUrl: URL): void {
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
