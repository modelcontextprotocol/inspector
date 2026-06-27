import type {
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  OAuthClientInformationSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthStorage } from "./storage.js";
import { type createOAuthStore, type ServerOAuthState } from "./store.js";
import type {
  IdpSessionState,
  OAuthClientRegistrationKind,
  SaveClientInformationOptions,
  SaveTokensOptions,
} from "./storage.js";

/**
 * Concrete OAuthStorage implementation parameterized on a Zustand store.
 * The store carries the storage adapter (sessionStorage, file, remote HTTP, …),
 * so the same body works for browser, Node, and remote environments.
 */
export class OAuthStorageBase implements OAuthStorage {
  private readonly store: ReturnType<typeof createOAuthStore>;

  constructor(store: ReturnType<typeof createOAuthStore>) {
    this.store = store;
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

  getClientRegistrationKind(
    serverUrl: string,
  ): OAuthClientRegistrationKind | undefined {
    return this.store.getState().getServerState(serverUrl)
      .clientRegistrationKind;
  }

  async saveClientInformation(
    serverUrl: string,
    clientInformation: OAuthClientInformation,
    options: SaveClientInformationOptions,
  ): Promise<void> {
    this.store.getState().setServerState(serverUrl, {
      clientInformation,
      clientRegistrationKind: options.registrationKind,
    });
  }

  async savePreregisteredClientInformation(
    serverUrl: string,
    clientInformation: OAuthClientInformation,
  ): Promise<void> {
    this.store.getState().setServerState(serverUrl, {
      preregisteredClientInformation: clientInformation,
      clientRegistrationKind: "static",
    });
  }

  clearClientInformation(serverUrl: string, isPreregistered?: boolean): void {
    const updates: Partial<ServerOAuthState> = {};

    if (isPreregistered) {
      updates.preregisteredClientInformation = undefined;
    } else {
      updates.clientInformation = undefined;
      updates.clientRegistrationKind = undefined;
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

  async saveTokens(
    serverUrl: string,
    tokens: OAuthTokens,
    options?: SaveTokensOptions,
  ): Promise<void> {
    this.store.getState().setServerState(serverUrl, {
      tokens,
      ...(options?.enterpriseManaged === true && { enterpriseManaged: true }),
    });
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

  async getIdpSession(issuer: string): Promise<IdpSessionState | undefined> {
    const session = this.store.getState().getIdpSession(issuer);
    if (
      !session.idToken &&
      !session.refreshToken &&
      session.idTokenExpiresAt === undefined
    ) {
      return undefined;
    }
    return session;
  }

  async saveIdpSession(
    issuer: string,
    session: Partial<IdpSessionState>,
  ): Promise<void> {
    this.store.getState().setIdpSession(issuer, session);
  }

  clearIdpSession(issuer: string): void {
    this.store.getState().clearIdpSession(issuer);
  }

  clearEnterpriseManagedResourceServers(): void {
    this.store.getState().clearEnterpriseManagedResourceServers();
  }
}
