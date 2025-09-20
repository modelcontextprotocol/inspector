import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthClientInformationSchema,
  OAuthClientInformation,
  OAuthTokens,
  OAuthTokensSchema,
  OAuthClientMetadata,
  OAuthMetadata,
  OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/sdk/client/auth.js";
import { SESSION_KEYS, getServerSpecificKey } from "./constants";
import { generateOAuthState } from "@/utils/oauthUtils";
import { validateRedirectUrl } from "@/utils/urlValidation";

/**
 * Discovers OAuth scopes from server metadata, with preference for resource metadata scopes
 * @param serverUrl - The MCP server URL
 * @param resourceMetadata - Optional resource metadata containing preferred scopes
 * @returns Promise resolving to space-separated scope string or undefined
 */
export const discoverScopes = async (
  serverUrl: string,
  resourceMetadata?: OAuthProtectedResourceMetadata,
): Promise<string | undefined> => {
  try {
    const metadata = await discoverAuthorizationServerMetadata(
      new URL("/", serverUrl),
    );

    // Prefer resource metadata scopes, but fall back to OAuth metadata if empty
    const resourceScopes = resourceMetadata?.scopes_supported;
    const oauthScopes = metadata?.scopes_supported;

    const scopesSupported =
      resourceScopes && resourceScopes.length > 0
        ? resourceScopes
        : oauthScopes;

    return scopesSupported && scopesSupported.length > 0
      ? scopesSupported.join(" ")
      : undefined;
  } catch (error) {
    console.debug("OAuth scope discovery failed:", error);
    return undefined;
  }
};

// Helper: simple reversible encoding of a string using the token (XOR + base64)
export const encodeWithKey = (key: string, plaintext: string): string => {
  const enc = new TextEncoder();
  const textBytes = enc.encode(plaintext);
  const keyBytes = enc.encode(key);
  const out = new Uint8Array(textBytes.length);
  for (let i = 0; i < textBytes.length; i++) {
    out[i] = textBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return btoa(String.fromCharCode(...out));
};

export const decodeWithKey = (key: string, encodedB64: string): string => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const keyBytes = enc.encode(key);
  const bytes = Uint8Array.from(atob(encodedB64), (c) => c.charCodeAt(0));
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return dec.decode(out);
};

export const getClientInformationFromSessionStorage = async ({
  serverUrl,
  isPreregistered,
  clientEncryptionKey,
}: {
  serverUrl: string;
  isPreregistered?: boolean;
  clientEncryptionKey: string;
}) => {
  const key = getServerSpecificKey(
    isPreregistered
      ? SESSION_KEYS.PREREGISTERED_CLIENT_INFORMATION
      : SESSION_KEYS.CLIENT_INFORMATION,
    serverUrl,
  );

  const value = sessionStorage.getItem(key);
  if (!value) {
    return undefined;
  }

  const parsed = await OAuthClientInformationSchema.parseAsync(
    JSON.parse(value),
  );

  // Decrypt client_secret if marked as encrypted and token is available
  try {
    if (clientEncryptionKey && parsed.client_secret) {
      const decrypted = decodeWithKey(
        clientEncryptionKey,
        parsed.client_secret as unknown as string,
      );
      return { ...parsed, client_secret: decrypted } as OAuthClientInformation;
    }
  } catch (e) {
    console.warn("Failed to decrypt client_secret from session storage:", e);
    // Fallback to parsed as-is
  }

  return parsed;
};

export const saveClientInformationToSessionStorage = ({
  serverUrl,
  clientInformation,
  isPreregistered,
  clientEncryptionKey,
}: {
  serverUrl: string;
  clientInformation: OAuthClientInformation;
  isPreregistered?: boolean;
  clientEncryptionKey: string;
}) => {
  const key = getServerSpecificKey(
    isPreregistered
      ? SESSION_KEYS.PREREGISTERED_CLIENT_INFORMATION
      : SESSION_KEYS.CLIENT_INFORMATION,
    serverUrl,
  );
  let toStore: Partial<OAuthClientInformation> & {
    _encrypted_client_secret?: boolean;
  } = { ...clientInformation };
  if (clientEncryptionKey && clientInformation.client_secret) {
    try {
      const encrypted = encodeWithKey(
        clientEncryptionKey,
        clientInformation.client_secret as unknown as string,
      );
      toStore = {
        ...toStore,
        client_secret: encrypted,
      };
    } catch (e) {
      console.warn("Failed to encrypt client_secret for session storage:", e);
    }
  }
  sessionStorage.setItem(key, JSON.stringify(toStore));
};

export const clearClientInformationFromSessionStorage = ({
  serverUrl,
  isPreregistered,
}: {
  serverUrl: string;
  isPreregistered?: boolean;
}) => {
  const key = getServerSpecificKey(
    isPreregistered
      ? SESSION_KEYS.PREREGISTERED_CLIENT_INFORMATION
      : SESSION_KEYS.CLIENT_INFORMATION,
    serverUrl,
  );
  sessionStorage.removeItem(key);
};

export class InspectorOAuthClientProvider implements OAuthClientProvider {
  constructor(
    protected serverUrl: string,
    protected clientEncryptionKey: string,
    scope?: string,
  ) {
    this.scope = scope;
    // Save the server URL to session storage
    sessionStorage.setItem(SESSION_KEYS.SERVER_URL, serverUrl);
  }
  scope: string | undefined;

  get redirectUrl() {
    return window.location.origin + "/oauth/callback";
  }

  get debugRedirectUrl() {
    return window.location.origin + "/oauth/callback/debug";
  }

  get clientMetadata(): OAuthClientMetadata {
    // Register both redirect URIs to support both normal and debug flows
    return {
      redirect_uris: [this.redirectUrl, this.debugRedirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "MCP Inspector",
      client_uri: "https://github.com/modelcontextprotocol/inspector",
      scope: this.scope ?? "",
    };
  }

  state(): string | Promise<string> {
    return generateOAuthState();
  }

  async clientInformation() {
    // Try to get the preregistered client information from session storage first
    const preregisteredClientInformation =
      await getClientInformationFromSessionStorage({
        serverUrl: this.serverUrl,
        isPreregistered: true,
        clientEncryptionKey: this.clientEncryptionKey,
      });

    // If no preregistered client information is found, get the dynamically registered client information
    return (
      preregisteredClientInformation ??
      (await getClientInformationFromSessionStorage({
        serverUrl: this.serverUrl,
        isPreregistered: false,
        clientEncryptionKey: this.clientEncryptionKey,
      }))
    );
  }

  saveClientInformation(clientInformation: OAuthClientInformation) {
    // Save the dynamically registered client information to session storage
    saveClientInformationToSessionStorage({
      serverUrl: this.serverUrl,
      clientInformation: clientInformation,
      isPreregistered: false,
      clientEncryptionKey: this.clientEncryptionKey,
    });
  }

  async tokens() {
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

  redirectToAuthorization(authorizationUrl: URL) {
    // Validate the URL using the shared utility
    validateRedirectUrl(authorizationUrl.href);
    window.location.href = authorizationUrl.href;
  }

  saveCodeVerifier(codeVerifier: string) {
    const key = getServerSpecificKey(
      SESSION_KEYS.CODE_VERIFIER,
      this.serverUrl,
    );
    sessionStorage.setItem(key, codeVerifier);
  }

  codeVerifier() {
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

  clear() {
    clearClientInformationFromSessionStorage({
      serverUrl: this.serverUrl,
      isPreregistered: false,
    });
    sessionStorage.removeItem(
      getServerSpecificKey(SESSION_KEYS.TOKENS, this.serverUrl),
    );
    sessionStorage.removeItem(
      getServerSpecificKey(SESSION_KEYS.CODE_VERIFIER, this.serverUrl),
    );
  }
}

// Overrides redirect URL to use the debug endpoint and allows saving server OAuth metadata to
// display in debug UI.
export class DebugInspectorOAuthClientProvider extends InspectorOAuthClientProvider {
  get redirectUrl(): string {
    // We can use the debug redirect URL here because it was already registered
    // in the parent class's clientMetadata along with the normal redirect URL
    return this.debugRedirectUrl;
  }

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
    super.clear();
    sessionStorage.removeItem(
      getServerSpecificKey(SESSION_KEYS.SERVER_METADATA, this.serverUrl),
    );
  }
}
