import type { OAuthStorage } from "./storage.js";
import type {
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  OAuthClientInformationSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { getServerSpecificKey, OAUTH_STORAGE_KEYS } from "./storage.js";

/**
 * Browser storage implementation using sessionStorage
 * For web client reference (not used by InspectorClient)
 */
export class BrowserOAuthStorage implements OAuthStorage {
  async getClientInformation(
    serverUrl: string,
    isPreregistered?: boolean,
  ): Promise<OAuthClientInformation | undefined> {
    const key = getServerSpecificKey(
      isPreregistered
        ? OAUTH_STORAGE_KEYS.PREREGISTERED_CLIENT_INFORMATION
        : OAUTH_STORAGE_KEYS.CLIENT_INFORMATION,
      serverUrl,
    );

    const value = sessionStorage.getItem(key);
    if (!value) {
      return undefined;
    }

    return await OAuthClientInformationSchema.parseAsync(JSON.parse(value));
  }

  async saveClientInformation(
    serverUrl: string,
    clientInformation: OAuthClientInformation,
  ): Promise<void> {
    const key = getServerSpecificKey(
      OAUTH_STORAGE_KEYS.CLIENT_INFORMATION,
      serverUrl,
    );
    sessionStorage.setItem(key, JSON.stringify(clientInformation));
  }

  async savePreregisteredClientInformation(
    serverUrl: string,
    clientInformation: OAuthClientInformation,
  ): Promise<void> {
    const key = getServerSpecificKey(
      OAUTH_STORAGE_KEYS.PREREGISTERED_CLIENT_INFORMATION,
      serverUrl,
    );
    sessionStorage.setItem(key, JSON.stringify(clientInformation));
  }

  clearClientInformation(serverUrl: string, isPreregistered?: boolean): void {
    const key = getServerSpecificKey(
      isPreregistered
        ? OAUTH_STORAGE_KEYS.PREREGISTERED_CLIENT_INFORMATION
        : OAUTH_STORAGE_KEYS.CLIENT_INFORMATION,
      serverUrl,
    );
    sessionStorage.removeItem(key);
  }

  async getTokens(serverUrl: string): Promise<OAuthTokens | undefined> {
    const key = getServerSpecificKey(OAUTH_STORAGE_KEYS.TOKENS, serverUrl);
    const tokens = sessionStorage.getItem(key);
    if (!tokens) {
      return undefined;
    }

    return await OAuthTokensSchema.parseAsync(JSON.parse(tokens));
  }

  async saveTokens(serverUrl: string, tokens: OAuthTokens): Promise<void> {
    const key = getServerSpecificKey(OAUTH_STORAGE_KEYS.TOKENS, serverUrl);
    sessionStorage.setItem(key, JSON.stringify(tokens));
  }

  clearTokens(serverUrl: string): void {
    const key = getServerSpecificKey(OAUTH_STORAGE_KEYS.TOKENS, serverUrl);
    sessionStorage.removeItem(key);
  }

  getCodeVerifier(serverUrl: string): string | undefined {
    const key = getServerSpecificKey(
      OAUTH_STORAGE_KEYS.CODE_VERIFIER,
      serverUrl,
    );
    return sessionStorage.getItem(key) || undefined;
  }

  async saveCodeVerifier(
    serverUrl: string,
    codeVerifier: string,
  ): Promise<void> {
    const key = getServerSpecificKey(
      OAUTH_STORAGE_KEYS.CODE_VERIFIER,
      serverUrl,
    );
    sessionStorage.setItem(key, codeVerifier);
  }

  clearCodeVerifier(serverUrl: string): void {
    const key = getServerSpecificKey(
      OAUTH_STORAGE_KEYS.CODE_VERIFIER,
      serverUrl,
    );
    sessionStorage.removeItem(key);
  }

  getScope(serverUrl: string): string | undefined {
    const key = getServerSpecificKey(OAUTH_STORAGE_KEYS.SCOPE, serverUrl);
    return sessionStorage.getItem(key) || undefined;
  }

  async saveScope(serverUrl: string, scope: string | undefined): Promise<void> {
    const key = getServerSpecificKey(OAUTH_STORAGE_KEYS.SCOPE, serverUrl);
    if (scope) {
      sessionStorage.setItem(key, scope);
    } else {
      sessionStorage.removeItem(key);
    }
  }

  clearScope(serverUrl: string): void {
    const key = getServerSpecificKey(OAUTH_STORAGE_KEYS.SCOPE, serverUrl);
    sessionStorage.removeItem(key);
  }

  getServerMetadata(serverUrl: string): OAuthMetadata | null {
    const key = getServerSpecificKey(
      OAUTH_STORAGE_KEYS.SERVER_METADATA,
      serverUrl,
    );
    const metadata = sessionStorage.getItem(key);
    if (!metadata) {
      return null;
    }
    return JSON.parse(metadata);
  }

  async saveServerMetadata(
    serverUrl: string,
    metadata: OAuthMetadata,
  ): Promise<void> {
    const key = getServerSpecificKey(
      OAUTH_STORAGE_KEYS.SERVER_METADATA,
      serverUrl,
    );
    sessionStorage.setItem(key, JSON.stringify(metadata));
  }

  clearServerMetadata(serverUrl: string): void {
    const key = getServerSpecificKey(
      OAUTH_STORAGE_KEYS.SERVER_METADATA,
      serverUrl,
    );
    sessionStorage.removeItem(key);
  }

  clear(serverUrl: string): void {
    this.clearClientInformation(serverUrl, false);
    this.clearClientInformation(serverUrl, true);
    this.clearTokens(serverUrl);
    this.clearCodeVerifier(serverUrl);
    this.clearScope(serverUrl);
    this.clearServerMetadata(serverUrl);
  }
}
