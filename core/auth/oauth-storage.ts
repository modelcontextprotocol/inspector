import type {
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/client";
import {
  OAuthClientInformationSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/core";
import type { OAuthStorage } from "./storage.js";
import { type OAuthMemoryStore, type ServerOAuthState } from "./store.js";
import type { OAuthPersistBackend } from "./oauth-persist.js";
import type {
  IdpSessionState,
  OAuthClientRegistrationKind,
  SaveClientInformationOptions,
  SaveTokensOptions,
} from "./storage.js";

/**
 * Concrete OAuthStorage implementation backed by in-memory state and an explicit
 * persist backend (file, remote HTTP, sessionStorage, …).
 */
export class OAuthStorageBase implements OAuthStorage {
  private loaded = false;
  private loadPromise: Promise<void> | undefined;
  /** Serializes persist writes so concurrent mutators cannot reorder POSTs. */
  private persistQueue: Promise<void> = Promise.resolve();
  private readonly memory: OAuthMemoryStore;
  private readonly backend: OAuthPersistBackend;

  constructor(memory: OAuthMemoryStore, backend: OAuthPersistBackend) {
    this.memory = memory;
    this.backend = backend;
  }

  load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.doLoad();
    }
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    if (this.loaded) {
      return;
    }
    const snapshot = await this.backend.read();
    if (snapshot) {
      this.memory.replace(snapshot);
    }
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    await this.load();
  }

  private async persist(): Promise<void> {
    const snapshot = this.memory.snapshot();
    const prior = this.persistQueue;
    const tracked = prior
      .catch(() => {})
      .then(() => this.backend.write(snapshot));
    this.persistQueue = tracked;
    await tracked;
  }

  async getClientInformation(
    serverUrl: string,
    isPreregistered?: boolean,
  ): Promise<OAuthClientInformation | undefined> {
    await this.ensureLoaded();
    const state = this.memory.getState().getServerState(serverUrl);
    const clientInfo = isPreregistered
      ? state.preregisteredClientInformation
      : state.clientInformation;

    if (!clientInfo) {
      return undefined;
    }

    return await OAuthClientInformationSchema.parseAsync(clientInfo);
  }

  async getClientRegistrationKind(
    serverUrl: string,
  ): Promise<OAuthClientRegistrationKind | undefined> {
    await this.ensureLoaded();
    return this.memory.getState().getServerState(serverUrl)
      .clientRegistrationKind;
  }

  async saveClientInformation(
    serverUrl: string,
    clientInformation: OAuthClientInformation,
    options: SaveClientInformationOptions,
  ): Promise<void> {
    await this.ensureLoaded();
    this.memory.getState().setServerState(serverUrl, {
      clientInformation,
      clientRegistrationKind: options.registrationKind,
    });
    await this.persist();
  }

  async savePreregisteredClientInformation(
    serverUrl: string,
    clientInformation: OAuthClientInformation,
  ): Promise<void> {
    await this.ensureLoaded();
    this.memory.getState().setServerState(serverUrl, {
      preregisteredClientInformation: clientInformation,
      clientRegistrationKind: "static",
    });
    await this.persist();
  }

  async clearClientInformation(
    serverUrl: string,
    isPreregistered?: boolean,
  ): Promise<void> {
    await this.ensureLoaded();
    const updates: Partial<ServerOAuthState> = {};

    if (isPreregistered) {
      updates.preregisteredClientInformation = undefined;
    } else {
      updates.clientInformation = undefined;
      updates.clientRegistrationKind = undefined;
    }

    this.memory.getState().setServerState(serverUrl, updates);
    await this.persist();
  }

  async getTokens(serverUrl: string): Promise<OAuthTokens | undefined> {
    await this.ensureLoaded();
    const state = this.memory.getState().getServerState(serverUrl);
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
    await this.ensureLoaded();
    this.memory.getState().setServerState(serverUrl, {
      tokens,
      ...(options?.enterpriseManaged === true && { enterpriseManaged: true }),
    });
    await this.persist();
  }

  async clearTokens(serverUrl: string): Promise<void> {
    await this.ensureLoaded();
    this.memory.getState().setServerState(serverUrl, { tokens: undefined });
    await this.persist();
  }

  async getCodeVerifier(serverUrl: string): Promise<string | undefined> {
    await this.ensureLoaded();
    const state = this.memory.getState().getServerState(serverUrl);
    return state.codeVerifier;
  }

  async saveCodeVerifier(
    serverUrl: string,
    codeVerifier: string,
  ): Promise<void> {
    await this.ensureLoaded();
    this.memory.getState().setServerState(serverUrl, { codeVerifier });
    await this.persist();
  }

  async clearCodeVerifier(serverUrl: string): Promise<void> {
    await this.ensureLoaded();
    this.memory
      .getState()
      .setServerState(serverUrl, { codeVerifier: undefined });
    await this.persist();
  }

  async getScope(serverUrl: string): Promise<string | undefined> {
    await this.ensureLoaded();
    const state = this.memory.getState().getServerState(serverUrl);
    return state.scope;
  }

  async saveScope(serverUrl: string, scope: string | undefined): Promise<void> {
    await this.ensureLoaded();
    this.memory.getState().setServerState(serverUrl, { scope });
    await this.persist();
  }

  async clearScope(serverUrl: string): Promise<void> {
    await this.ensureLoaded();
    this.memory.getState().setServerState(serverUrl, { scope: undefined });
    await this.persist();
  }

  async getServerMetadata(serverUrl: string): Promise<OAuthMetadata | null> {
    await this.ensureLoaded();
    const state = this.memory.getState().getServerState(serverUrl);
    return state.serverMetadata || null;
  }

  async saveServerMetadata(
    serverUrl: string,
    metadata: OAuthMetadata,
  ): Promise<void> {
    await this.ensureLoaded();
    this.memory
      .getState()
      .setServerState(serverUrl, { serverMetadata: metadata });
    await this.persist();
  }

  async clearServerMetadata(serverUrl: string): Promise<void> {
    await this.ensureLoaded();
    this.memory
      .getState()
      .setServerState(serverUrl, { serverMetadata: undefined });
    await this.persist();
  }

  async clear(serverUrl: string): Promise<void> {
    await this.ensureLoaded();
    this.memory.getState().clearServerState(serverUrl);
    await this.persist();
  }

  async getIdpSession(issuer: string): Promise<IdpSessionState | undefined> {
    await this.ensureLoaded();
    const session = this.memory.getState().getIdpSession(issuer);
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
    await this.ensureLoaded();
    this.memory.getState().setIdpSession(issuer, session);
    await this.persist();
  }

  async clearIdpSession(issuer: string): Promise<void> {
    await this.ensureLoaded();
    this.memory.getState().clearIdpSession(issuer);
    await this.persist();
  }

  async clearEnterpriseManagedResourceServers(): Promise<void> {
    await this.ensureLoaded();
    this.memory.getState().clearEnterpriseManagedResourceServers();
    await this.persist();
  }
}
