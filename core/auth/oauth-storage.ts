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
 * With an async storage adapter (file, remote HTTP) the store is empty until
 * hydration completes. Every read used on the post-OAuth-redirect callback path
 * (`getCodeVerifier`, `getServerMetadata`, `getClientInformation`, `getTokens`)
 * — and every save — therefore awaits {@link hydrated} first; saves wait so a
 * late hydration merge cannot clobber a value written before it landed. The
 * underlying store is created with `skipHydration: true`
 * ({@link createOAuthStore}), so the constructor's `rehydrate()` is the single
 * hydration and there is no auto-hydration to race it. With a synchronous
 * adapter (sessionStorage) hydration resolves on the next microtask and the
 * behaviour is effectively unchanged.
 */
export class OAuthStorageBase implements OAuthStorage {
  private readonly store: ReturnType<typeof createOAuthStore>;
  private readonly hydrated: Promise<void>;
  private hydrationError?: Error;

  constructor(store: ReturnType<typeof createOAuthStore>) {
    this.store = store;
    // The store is created with `skipHydration: true` so this is the SOLE
    // hydration. Driving it explicitly (rather than relying on persist's
    // auto-hydration + onFinishHydration) lets us catch a rejecting adapter —
    // onFinishHydration only fires on success, so a throwing getItem would
    // otherwise leave `hydrated` pending forever and hang every getter.
    // A failed hydration resolves to "empty store", which is the correct
    // fallback (reads return undefined; writes proceed) — but the failure is
    // recorded so callers can distinguish "no token stored" from "could not
    // read the store" (e.g. corrupt file, EACCES, backend 500).
    const recordFailure = (err: unknown) => {
      this.hydrationError =
        err instanceof Error
          ? err
          : new Error(
              typeof err === "string"
                ? err
                : "OAuth storage hydration failed (adapter getItem threw or returned invalid data)",
            );
      console.warn(
        "[OAuthStorage] hydration failed; continuing with empty state:",
        this.hydrationError,
      );
    };
    this.hydrated = this.store.persist.hasHydrated()
      ? Promise.resolve()
      : Promise.resolve(this.store.persist.rehydrate()).then(
          () => {
            // Zustand swallows getItem errors internally (routing them to
            // onRehydrateStorage) and resolves rehydrate() regardless;
            // hasHydrated() only flips true on success, so use it to detect a
            // silently-failed hydration. The underlying error is lost in this
            // path — record a generic one so getHydrationError() is non-null.
            if (!this.store.persist.hasHydrated()) recordFailure(undefined);
          },
          (err: unknown) => recordFailure(err),
        );
  }

  /**
   * If hydration failed (adapter threw, file unreadable/corrupt, backend
   * non-2xx), the captured error. Undefined when hydration succeeded or has
   * not yet completed — call after `await ready()`. Lets callers report
   * "oauth.json is unreadable" instead of a misleading "no token stored".
   */
  getHydrationError(): Error | undefined {
    return this.hydrationError;
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
    await this.hydrated;
    this.store.getState().setServerState(serverUrl, {
      clientInformation,
    });
  }

  async savePreregisteredClientInformation(
    serverUrl: string,
    clientInformation: OAuthClientInformation,
  ): Promise<void> {
    await this.hydrated;
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
    await this.hydrated;
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
    await this.hydrated;
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
    await this.hydrated;
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
    await this.hydrated;
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
