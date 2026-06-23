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

/**
 * Concrete OAuthStorage implementation parameterized on a Zustand store.
 * The store carries the storage adapter (sessionStorage, file, remote HTTP, …),
 * so the same body works for browser, Node, and remote environments.
 *
 * With an async storage adapter (file, remote HTTP) the persist middleware
 * hydrates the store after construction, so `store.getState()` is empty until
 * that completes. Every read used on the post-OAuth-redirect callback path
 * (`getCodeVerifier`, `getServerMetadata`, `getClientInformation`, `getTokens`)
 * therefore awaits {@link hydrated} before reading state. With a synchronous
 * adapter (sessionStorage) hydration finishes before the constructor returns,
 * so the await resolves immediately and the behaviour is unchanged.
 */
export class OAuthStorageBase implements OAuthStorage {
  private readonly store: ReturnType<typeof createOAuthStore>;
  private readonly hydrated: Promise<void>;

  constructor(store: ReturnType<typeof createOAuthStore>) {
    this.store = store;
    this.hydrated = this.store.persist.hasHydrated()
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const unsub = this.store.persist.onFinishHydration(() => {
            unsub();
            resolve();
          });
        });
  }

  /**
   * Resolves once the underlying persist adapter has hydrated the store.
   * Callers that need to read state outside the typed getters can await this
   * directly (e.g. before reading the store via `getState()` for diagnostics).
   */
  ready(): Promise<void> {
    return this.hydrated;
  }

  async getClientInformation(
    serverUrl: string,
    isPreregistered?: boolean,
  ): Promise<OAuthClientInformation | undefined> {
    await this.hydrated;
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
    const updates: Partial<ServerOAuthState> = {};

    if (isPreregistered) {
      updates.preregisteredClientInformation = undefined;
    } else {
      updates.clientInformation = undefined;
    }

    this.store.getState().setServerState(serverUrl, updates);
  }

  async getTokens(serverUrl: string): Promise<OAuthTokens | undefined> {
    await this.hydrated;
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

  async getCodeVerifier(serverUrl: string): Promise<string | undefined> {
    await this.hydrated;
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

  /**
   * Intentionally synchronous. The only caller is
   * {@link BaseOAuthClientProvider.scope}, a sync getter the SDK requires
   * (it feeds the sync `clientMetadata` getter). Scope is always set via
   * {@link saveScope} in the same session before it's read (during the
   * pre-redirect half of the flow), so the in-memory store has the value
   * regardless of async hydration.
   */
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

  async getServerMetadata(serverUrl: string): Promise<OAuthMetadata | null> {
    await this.hydrated;
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
