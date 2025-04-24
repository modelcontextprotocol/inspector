import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthClientInformationSchema,
  OAuthClientInformation,
  OAuthTokens,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { SESSION_KEYS, getServerSpecificKey } from "./constants";

export class InspectorOAuthClientProvider implements OAuthClientProvider {
  constructor(private serverUrl: string) {
    // Save the server URL to session storage
    sessionStorage.setItem(SESSION_KEYS.SERVER_URL, serverUrl);
  }

  get redirectUrl() {
    return window.location.origin + "/oauth/callback";
  }

  get clientMetadata() {
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
    sessionStorage.removeItem(
      getServerSpecificKey(SESSION_KEYS.CLIENT_INFORMATION, this.serverUrl),
    );
    sessionStorage.removeItem(
      getServerSpecificKey(SESSION_KEYS.TOKENS, this.serverUrl),
    );
    sessionStorage.removeItem(
      getServerSpecificKey(SESSION_KEYS.CODE_VERIFIER, this.serverUrl),
    );
  }
}
