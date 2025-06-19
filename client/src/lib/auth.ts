import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthClientInformationSchema,
  OAuthClientInformation,
  OAuthTokens,
  OAuthTokensSchema,
  OAuthClientMetadata,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { SESSION_KEYS, getServerSpecificKey } from "./constants";

// Define a storage interface that can be implemented for different storage backends
export interface StorageInterface {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// Default browser session storage implementation
export class SessionStorageAdapter implements StorageInterface {
  getItem(key: string): string | null {
    return sessionStorage.getItem(key);
  }

  setItem(key: string, value: string): void {
    sessionStorage.setItem(key, value);
  }

  removeItem(key: string): void {
    sessionStorage.removeItem(key);
  }
}

export class InspectorOAuthClientProvider implements OAuthClientProvider {
  protected storage: StorageInterface;

  constructor(
    public serverUrl: string,
    storage?: StorageInterface
  ) {
    this.storage = storage || new SessionStorageAdapter();
    
    // Save the server URL to storage
    this.storage.setItem(SESSION_KEYS.SERVER_URL, serverUrl);
  }

  get redirectUrl() {
    return window.location.origin + "/oauth/callback";
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "MCP Inspector",
      client_uri: "https://github.com/modelcontextprotocol/inspector",
    };
  }

  async clientInformation() {
    const key = getServerSpecificKey(
      SESSION_KEYS.CLIENT_INFORMATION,
      this.serverUrl,
    );
    const value = this.storage.getItem(key);
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
    this.storage.setItem(key, JSON.stringify(clientInformation));
  }

  async tokens() {
    const key = getServerSpecificKey(SESSION_KEYS.TOKENS, this.serverUrl);
    const tokens = this.storage.getItem(key);
    if (!tokens) {
      return undefined;
    }

    return await OAuthTokensSchema.parseAsync(JSON.parse(tokens));
  }

  saveTokens(tokens: OAuthTokens) {
    const key = getServerSpecificKey(SESSION_KEYS.TOKENS, this.serverUrl);
    this.storage.setItem(key, JSON.stringify(tokens));
  }

  redirectToAuthorization(authorizationUrl: URL) {
    // This is a browser-specific method - will be overridden for CLI usage
    if (typeof window !== 'undefined' && window.location) {
      window.location.href = authorizationUrl.href;
    } else {
      console.log(`Please open this URL in your browser: ${authorizationUrl.href}`);
    }
  }

  saveCodeVerifier(codeVerifier: string) {
    const key = getServerSpecificKey(
      SESSION_KEYS.CODE_VERIFIER,
      this.serverUrl,
    );
    this.storage.setItem(key, codeVerifier);
  }

  codeVerifier() {
    const key = getServerSpecificKey(
      SESSION_KEYS.CODE_VERIFIER,
      this.serverUrl,
    );
    const verifier = this.storage.getItem(key);
    if (!verifier) {
      throw new Error("No code verifier saved for session");
    }

    return verifier;
  }

  clear() {
    this.storage.removeItem(
      getServerSpecificKey(SESSION_KEYS.CLIENT_INFORMATION, this.serverUrl),
    );
    this.storage.removeItem(
      getServerSpecificKey(SESSION_KEYS.TOKENS, this.serverUrl),
    );
    this.storage.removeItem(
      getServerSpecificKey(SESSION_KEYS.CODE_VERIFIER, this.serverUrl),
    );
  }
}

// Overrides debug URL and allows saving server OAuth metadata to
// display in debug UI.
export class DebugInspectorOAuthClientProvider extends InspectorOAuthClientProvider {
  constructor(
    serverUrl: string,
    storage?: StorageInterface
  ) {
    super(serverUrl, storage);
  }

  get redirectUrl(): string {
    if (typeof window !== 'undefined' && window.location) {
      return `${window.location.origin}/oauth/callback/debug`;
    }
    // For CLI usage, default to a localhost URL
    return 'http://localhost:3000/oauth/callback/debug';
  }

  saveServerMetadata(metadata: OAuthMetadata) {
    const key = getServerSpecificKey(
      SESSION_KEYS.SERVER_METADATA,
      this.serverUrl,
    );
    this.storage.setItem(key, JSON.stringify(metadata));
  }

  getServerMetadata(): OAuthMetadata | null {
    const key = getServerSpecificKey(
      SESSION_KEYS.SERVER_METADATA,
      this.serverUrl,
    );
    const metadata = this.storage.getItem(key);
    if (!metadata) {
      return null;
    }
    return JSON.parse(metadata);
  }

  clear() {
    super.clear();
    this.storage.removeItem(
      getServerSpecificKey(SESSION_KEYS.SERVER_METADATA, this.serverUrl),
    );
  }
}
