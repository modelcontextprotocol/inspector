import { createJSONStorage } from "zustand/middleware";
import type { OAuthStorage } from "../storage.js";
import type {
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  OAuthClientInformationSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { createOAuthStore, type ServerOAuthState } from "../store.js";

/**
 * Browser storage implementation using Zustand with sessionStorage.
 * For web client (can be used by InspectorClient in browser).
 */
export class BrowserOAuthStorage implements OAuthStorage {
  private store: ReturnType<typeof createOAuthStore>;

  constructor() {
    // Use Zustand's built-in sessionStorage adapter
    // The `name` option in persist() ("mcp-inspector-oauth") becomes the sessionStorage key
    const storage = createJSONStorage(() => sessionStorage);
    this.store = createOAuthStore(storage);
  }
  async getClientInformation(
    serverUrl: string,
    isPreregistered?: boolean,
  ): Promise<OAuthClientInformation | undefined> {
    const state = this.store.getState().getServerState(serverUrl);
    const clientInfo = isPreregistered
      ? state.preregisteredClientInformation
      : state.clientInformation;

    if (!clientInfo) {
      return undefined;
    }

    return await OAuthClientInformationSchema.parseAsync(clientInfo);
  }

  async saveClientInformation(
    serverUrl: string,
    clientInformation: OAuthClientInformation,
  ): Promise<void> {
    this.store.getState().setServerState(serverUrl, {
      clientInformation,
    });
  }

  async savePreregisteredClientInformation(
    serverUrl: string,
    clientInformation: OAuthClientInformation,
  ): Promise<void> {
    this.store.getState().setServerState(serverUrl, {
      preregisteredClientInformation: clientInformation,
    });
  }

  clearClientInformation(serverUrl: string, isPreregistered?: boolean): void {
    const state = this.store.getState().getServerState(serverUrl);
    const updates: Partial<ServerOAuthState> = {};

    if (isPreregistered) {
      updates.preregisteredClientInformation = undefined;
    } else {
      updates.clientInformation = undefined;
    }

    this.store.getState().setServerState(serverUrl, updates);
  }

  async getTokens(serverUrl: string): Promise<OAuthTokens | undefined> {
    const state = this.store.getState().getServerState(serverUrl);
    if (!state.tokens) {
      return undefined;
    }

    return await OAuthTokensSchema.parseAsync(state.tokens);
  }

  async saveTokens(serverUrl: string, tokens: OAuthTokens): Promise<void> {
    this.store.getState().setServerState(serverUrl, { tokens });
  }

  clearTokens(serverUrl: string): void {
    this.store.getState().setServerState(serverUrl, { tokens: undefined });
  }

  getCodeVerifier(serverUrl: string): string | undefined {
    const state = this.store.getState().getServerState(serverUrl);
    return state.codeVerifier;
  }

  async saveCodeVerifier(
    serverUrl: string,
    codeVerifier: string,
  ): Promise<void> {
    this.store.getState().setServerState(serverUrl, { codeVerifier });
  }

  clearCodeVerifier(serverUrl: string): void {
    this.store
      .getState()
      .setServerState(serverUrl, { codeVerifier: undefined });
  }

  getScope(serverUrl: string): string | undefined {
    const state = this.store.getState().getServerState(serverUrl);
    return state.scope;
  }

  async saveScope(serverUrl: string, scope: string | undefined): Promise<void> {
    this.store.getState().setServerState(serverUrl, { scope });
  }

  clearScope(serverUrl: string): void {
    this.store.getState().setServerState(serverUrl, { scope: undefined });
  }

  getServerMetadata(serverUrl: string): OAuthMetadata | null {
    const state = this.store.getState().getServerState(serverUrl);
    return state.serverMetadata || null;
  }

  async saveServerMetadata(
    serverUrl: string,
    metadata: OAuthMetadata,
  ): Promise<void> {
    this.store
      .getState()
      .setServerState(serverUrl, { serverMetadata: metadata });
  }

  clearServerMetadata(serverUrl: string): void {
    this.store
      .getState()
      .setServerState(serverUrl, { serverMetadata: undefined });
  }

  clear(serverUrl: string): void {
    this.store.getState().clearServerState(serverUrl);
  }
}
