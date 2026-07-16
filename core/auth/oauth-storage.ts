import type {
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadata,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/client";
import {
  OAuthClientInformationSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/core";
import type { OAuthStorage } from "./storage.js";
import {
  type OAuthMemoryStore,
  type ServerOAuthState,
  type IssuerBoundOAuthState,
} from "./store.js";
import type { OAuthPersistBackend } from "./oauth-persist.js";
import type {
  IdpSessionState,
  OAuthClientRegistrationKind,
  SaveClientInformationOptions,
  SaveTokensOptions,
} from "./storage.js";

/**
 * Re-attach the `issuer` stamp (SEP-2352) that `OAuthTokensSchema` /
 * `OAuthClientInformationSchema` strip on parse. The stamp is the `byIssuer` key,
 * so it is recovered from the key rather than the parsed value — this is what lets
 * the SDK's `discardIfIssuerMismatch` reject cross-AS credential reuse.
 */
function withIssuer<T extends object>(value: T, issuer: string | undefined): T {
  return issuer === undefined ? value : { ...value, issuer };
}

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

  /**
   * Resolve the AS-`issuer` key whose credentials answer a read. An explicit
   * `issuer` (from the SDK's `ctx.issuer`) wins; otherwise the most-recently-saved
   * `activeIssuer` answers the transport's ctx-less per-request bearer read.
   */
  private resolveReadIssuer(
    state: ServerOAuthState,
    issuer?: string,
  ): string | undefined {
    return issuer ?? state.activeIssuer;
  }

  /** Read the issuer-bound slot for a read, if one exists. */
  private issuerSlot(
    state: ServerOAuthState,
    issuer?: string,
  ): IssuerBoundOAuthState | undefined {
    const key = this.resolveReadIssuer(state, issuer);
    return key ? state.byIssuer?.[key] : undefined;
  }

  /**
   * Read-modify-write the `byIssuer[issuer]` slot, set `activeIssuer`, and clear
   * the given legacy top-level fallback fields (lazy migration — the fallback is
   * promoted into the keyed slot on first issuer-stamped save).
   */
  private updateIssuerSlot(
    serverUrl: string,
    issuer: string,
    updates: Partial<IssuerBoundOAuthState>,
    clearLegacy: Partial<ServerOAuthState>,
    // Saves promote the issuer to `activeIssuer` (it answers ctx-less reads);
    // clears must not — clearing one AS's credentials shouldn't make it the
    // active one.
    setActive = true,
  ): void {
    const state = this.memory.getState().getServerState(serverUrl);
    const byIssuer = {
      ...state.byIssuer,
      [issuer]: { ...state.byIssuer?.[issuer], ...updates },
    };
    this.memory.getState().setServerState(serverUrl, {
      byIssuer,
      ...(setActive && { activeIssuer: issuer }),
      ...clearLegacy,
    });
  }

  /** Apply `fn` to every issuer slot (used by issuer-agnostic clears). */
  private mapIssuerSlots(
    state: ServerOAuthState,
    fn: (slot: IssuerBoundOAuthState) => Partial<IssuerBoundOAuthState>,
  ): Record<string, IssuerBoundOAuthState> {
    const byIssuer: Record<string, IssuerBoundOAuthState> = {};
    for (const [key, slot] of Object.entries(state.byIssuer ?? {})) {
      byIssuer[key] = { ...slot, ...fn(slot) };
    }
    return byIssuer;
  }

  async getClientInformation(
    serverUrl: string,
    isPreregistered?: boolean,
    issuer?: string,
  ): Promise<OAuthClientInformation | undefined> {
    await this.ensureLoaded();
    const state = this.memory.getState().getServerState(serverUrl);

    if (isPreregistered) {
      const prereg = state.preregisteredClientInformation;
      return prereg
        ? await OAuthClientInformationSchema.parseAsync(prereg)
        : undefined;
    }

    // Per-issuer registration (SEP-2352), falling back to the legacy unkeyed slot.
    const slot = this.issuerSlot(state, issuer);
    const fromSlot = slot?.clientInformation;
    const clientInfo = fromSlot ?? state.clientInformation;
    if (!clientInfo) {
      return undefined;
    }
    const parsed = await OAuthClientInformationSchema.parseAsync(clientInfo);
    // Stamp only when the value actually came from the issuer-keyed slot. Gating
    // on `fromSlot` (not merely on the slot existing) keeps a legacy unkeyed
    // credential — potentially minted by a *different* AS — from being stamped
    // with this issuer, which would defeat the SDK's discardIfIssuerMismatch.
    return withIssuer(
      parsed,
      fromSlot ? this.resolveReadIssuer(state, issuer) : undefined,
    );
  }

  async getClientRegistrationKind(
    serverUrl: string,
    issuer?: string,
  ): Promise<OAuthClientRegistrationKind | undefined> {
    await this.ensureLoaded();
    const state = this.memory.getState().getServerState(serverUrl);
    return (
      this.issuerSlot(state, issuer)?.clientRegistrationKind ??
      state.clientRegistrationKind
    );
  }

  async saveClientInformation(
    serverUrl: string,
    clientInformation: OAuthClientInformation,
    options: SaveClientInformationOptions,
  ): Promise<void> {
    await this.ensureLoaded();
    if (options.issuer !== undefined) {
      this.updateIssuerSlot(
        serverUrl,
        options.issuer,
        {
          clientInformation,
          clientRegistrationKind: options.registrationKind,
        },
        { clientInformation: undefined, clientRegistrationKind: undefined },
      );
    } else {
      // No issuer yet (our own DCR/CIMD pre-registration callers): write the
      // unkeyed slot; the SDK promotes it per-issuer on the next stamped save.
      this.memory.getState().setServerState(serverUrl, {
        clientInformation,
        clientRegistrationKind: options.registrationKind,
      });
    }
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
    issuer?: string,
  ): Promise<void> {
    await this.ensureLoaded();

    if (isPreregistered) {
      this.memory.getState().setServerState(serverUrl, {
        preregisteredClientInformation: undefined,
      });
      await this.persist();
      return;
    }

    if (issuer !== undefined) {
      this.updateIssuerSlot(
        serverUrl,
        issuer,
        { clientInformation: undefined, clientRegistrationKind: undefined },
        {},
        false,
      );
    } else {
      // Clear every issuer's registration plus the legacy unkeyed entry.
      const state = this.memory.getState().getServerState(serverUrl);
      const byIssuer = this.mapIssuerSlots(state, () => ({
        clientInformation: undefined,
        clientRegistrationKind: undefined,
      }));
      this.memory.getState().setServerState(serverUrl, {
        byIssuer,
        clientInformation: undefined,
        clientRegistrationKind: undefined,
      });
    }
    await this.persist();
  }

  async getTokens(
    serverUrl: string,
    issuer?: string,
  ): Promise<OAuthTokens | undefined> {
    await this.ensureLoaded();
    const state = this.memory.getState().getServerState(serverUrl);
    const slot = this.issuerSlot(state, issuer);
    const fromSlot = slot?.tokens;
    const tokens = fromSlot ?? state.tokens;
    if (!tokens) {
      return undefined;
    }
    const parsed = await OAuthTokensSchema.parseAsync(tokens);
    // Stamp only when the value came from the issuer-keyed slot (see
    // getClientInformation) — never stamp a legacy unkeyed token with this issuer.
    return withIssuer(
      parsed,
      fromSlot ? this.resolveReadIssuer(state, issuer) : undefined,
    );
  }

  async saveTokens(
    serverUrl: string,
    tokens: OAuthTokens,
    options?: SaveTokensOptions,
  ): Promise<void> {
    await this.ensureLoaded();
    if (options?.issuer !== undefined) {
      this.updateIssuerSlot(
        serverUrl,
        options.issuer,
        { tokens },
        {
          tokens: undefined,
          ...(options.enterpriseManaged === true && {
            enterpriseManaged: true,
          }),
        },
      );
    } else {
      this.memory.getState().setServerState(serverUrl, {
        tokens,
        ...(options?.enterpriseManaged === true && { enterpriseManaged: true }),
      });
    }
    await this.persist();
  }

  async clearTokens(serverUrl: string, issuer?: string): Promise<void> {
    await this.ensureLoaded();
    if (issuer !== undefined) {
      this.updateIssuerSlot(
        serverUrl,
        issuer,
        { tokens: undefined },
        {},
        false,
      );
    } else {
      const state = this.memory.getState().getServerState(serverUrl);
      const byIssuer = this.mapIssuerSlots(state, () => ({
        tokens: undefined,
      }));
      this.memory
        .getState()
        .setServerState(serverUrl, { byIssuer, tokens: undefined });
    }
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

  async getDiscoveryState(
    serverUrl: string,
  ): Promise<OAuthDiscoveryState | undefined> {
    await this.ensureLoaded();
    return this.memory.getState().getServerState(serverUrl).discoveryState;
  }

  async saveDiscoveryState(
    serverUrl: string,
    state: OAuthDiscoveryState,
  ): Promise<void> {
    await this.ensureLoaded();
    this.memory.getState().setServerState(serverUrl, { discoveryState: state });
    await this.persist();
  }

  async clearDiscoveryState(serverUrl: string): Promise<void> {
    await this.ensureLoaded();
    this.memory
      .getState()
      .setServerState(serverUrl, { discoveryState: undefined });
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
