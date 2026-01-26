/**
 * OAuth provider for the debug flow that intercepts the authorization redirect
 * and allows manual entry of the authorization code.
 */

import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
  OAuthTokensSchema,
  OAuthClientInformationSchema,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { SESSION_KEYS, getServerSpecificKey } from "./constants";
import { generateOAuthState } from "@/utils/oauthUtils";

/**
 * Handler type for when the SDK wants to redirect to authorization.
 * The handler receives the authorization URL and should return the
 * authorization code once the user completes the flow.
 */
export type AuthCodeHandler = (url: URL) => Promise<string>;

/**
 * Debug OAuth provider that extends the base provider to intercept
 * authorization redirects and allow manual code entry.
 */
export class DebugOAuthProvider implements OAuthClientProvider {
  private _authCodeHandler: AuthCodeHandler | null = null;
  private _pendingAuthCode: string | null = null;

  constructor(private serverUrl: string) {
    // Save the server URL to session storage
    sessionStorage.setItem(SESSION_KEYS.SERVER_URL, serverUrl);
  }

  /**
   * Sets the handler that will be called when authorization is needed.
   * The handler should display the URL to the user and wait for them
   * to enter the authorization code.
   */
  setAuthCodeHandler(handler: AuthCodeHandler) {
    this._authCodeHandler = handler;
  }

  /**
   * Returns any pending authorization code that was received.
   */
  getPendingAuthCode(): string | null {
    return this._pendingAuthCode;
  }

  /**
   * Clears the pending authorization code.
   */
  clearPendingAuthCode() {
    this._pendingAuthCode = null;
  }

  get redirectUrl(): string {
    return window.location.origin + "/oauth/callback/debug";
  }

  get clientMetadata(): OAuthClientMetadata {
    const metadata: OAuthClientMetadata = {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "MCP Inspector",
      client_uri: "https://github.com/modelcontextprotocol/inspector",
    };
    return metadata;
  }

  state(): string | Promise<string> {
    return generateOAuthState();
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const key = getServerSpecificKey(
      SESSION_KEYS.CLIENT_INFORMATION,
      this.serverUrl,
    );
    const value = sessionStorage.getItem(key);
    if (!value) {
      return undefined;
    }
    return await OAuthClientInformationSchema.parseAsync(JSON.parse(value));
  }

  saveClientInformation(clientInformation: OAuthClientInformation) {
    const key = getServerSpecificKey(
      SESSION_KEYS.CLIENT_INFORMATION,
      this.serverUrl,
    );
    sessionStorage.setItem(key, JSON.stringify(clientInformation));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const key = getServerSpecificKey(SESSION_KEYS.TOKENS, this.serverUrl);
    const tokens = sessionStorage.getItem(key);
    if (!tokens) {
      return undefined;
    }
    return await OAuthTokensSchema.parseAsync(JSON.parse(tokens));
  }

  saveTokens(tokens: OAuthTokens) {
    const key = getServerSpecificKey(SESSION_KEYS.TOKENS, this.serverUrl);
    sessionStorage.setItem(key, JSON.stringify(tokens));
  }

  /**
   * Instead of redirecting, this calls the auth code handler and waits
   * for the user to manually enter the code.
   */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this._authCodeHandler) {
      throw new Error(
        "Auth code handler not set - call setAuthCodeHandler before starting auth flow",
      );
    }
    // This blocks until user enters the code in the UI
    const code = await this._authCodeHandler(authorizationUrl);
    // Store code for retrieval by the caller
    this._pendingAuthCode = code;
  }

  saveCodeVerifier(codeVerifier: string) {
    const key = getServerSpecificKey(
      SESSION_KEYS.CODE_VERIFIER,
      this.serverUrl,
    );
    sessionStorage.setItem(key, codeVerifier);
  }

  codeVerifier(): string {
    const key = getServerSpecificKey(
      SESSION_KEYS.CODE_VERIFIER,
      this.serverUrl,
    );
    const verifier = sessionStorage.getItem(key);
    if (!verifier) {
      throw new Error("No code verifier saved for session");
    }
    return verifier;
  }

  // Additional methods for saving/retrieving server metadata for display

  saveServerMetadata(metadata: OAuthMetadata) {
    const key = getServerSpecificKey(
      SESSION_KEYS.SERVER_METADATA,
      this.serverUrl,
    );
    sessionStorage.setItem(key, JSON.stringify(metadata));
  }

  getServerMetadata(): OAuthMetadata | null {
    const key = getServerSpecificKey(
      SESSION_KEYS.SERVER_METADATA,
      this.serverUrl,
    );
    const metadata = sessionStorage.getItem(key);
    if (!metadata) {
      return null;
    }
    return JSON.parse(metadata);
  }

  clear() {
    const keys = [
      SESSION_KEYS.CLIENT_INFORMATION,
      SESSION_KEYS.TOKENS,
      SESSION_KEYS.CODE_VERIFIER,
      SESSION_KEYS.SERVER_METADATA,
    ];
    for (const baseKey of keys) {
      const key = getServerSpecificKey(baseKey, this.serverUrl);
      sessionStorage.removeItem(key);
    }
  }
}
