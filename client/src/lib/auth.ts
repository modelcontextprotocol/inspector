import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthClientInformationSchema,
  OAuthClientInformation,
  OAuthTokens,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { SESSION_KEYS } from "./constants";

class InspectorOAuthClientProvider implements OAuthClientProvider {
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
    const value = sessionStorage.getItem(SESSION_KEYS.CLIENT_INFORMATION);
    if (!value) {
      return undefined;
    }

    return await OAuthClientInformationSchema.parseAsync(JSON.parse(value));
  }

  saveClientInformation(clientInformation: OAuthClientInformation) {
    sessionStorage.setItem(
      SESSION_KEYS.CLIENT_INFORMATION,
      JSON.stringify(clientInformation),
    );
  }

  async tokens() {
    const tokens = sessionStorage.getItem(SESSION_KEYS.TOKENS);
    if (!tokens) {
      return undefined;
    }

    return await OAuthTokensSchema.parseAsync(JSON.parse(tokens));
  }

  saveTokens(tokens: OAuthTokens) {
    sessionStorage.setItem(SESSION_KEYS.TOKENS, JSON.stringify(tokens));
  }

  redirectToAuthorization(authorizationUrl: URL) {
    window.location.href = authorizationUrl.href;
  }

  saveCodeVerifier(codeVerifier: string) {
    sessionStorage.setItem(SESSION_KEYS.CODE_VERIFIER, codeVerifier);
  }

  codeVerifier() {
    const verifier = sessionStorage.getItem(SESSION_KEYS.CODE_VERIFIER);
    if (!verifier) {
      throw new Error("No code verifier saved for session");
    }

    return verifier;
  }

  clear() {
    sessionStorage.removeItem(SESSION_KEYS.CLIENT_INFORMATION);
    sessionStorage.removeItem(SESSION_KEYS.TOKENS);
    sessionStorage.removeItem(SESSION_KEYS.CODE_VERIFIER);
  }
}

export const authProvider = new InspectorOAuthClientProvider();
