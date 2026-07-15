/**
 * In-memory OAuth state store (servers + IdP sessions).
 * Persisted via `OAuthStorageBase` + `OAuthPersistBackend` backends.
 */

import type {
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/client";
import type {
  IdpSessionState,
  OAuthClientRegistrationKind,
} from "./storage.js";
import type { OAuthPersistSnapshot } from "./oauth-persist.js";

/**
 * OAuth state for a single server
 */
export interface ServerOAuthState {
  clientInformation?: OAuthClientInformation;
  /** Set when {@link clientInformation} is saved — DCR vs CIMD. */
  clientRegistrationKind?: OAuthClientRegistrationKind;
  preregisteredClientInformation?: OAuthClientInformation;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  scope?: string;
  serverMetadata?: OAuthMetadata;
  /** Set when resource tokens were minted via EMA (legs 2–3). */
  enterpriseManaged?: boolean;
}

/**
 * OAuth store state (all servers) plus mutation helpers.
 */
export interface OAuthStoreState {
  servers: Record<string, ServerOAuthState>;
  idpSessions: Record<string, IdpSessionState>;
  getServerState: (serverUrl: string) => ServerOAuthState;
  setServerState: (serverUrl: string, state: Partial<ServerOAuthState>) => void;
  clearServerState: (serverUrl: string) => void;
  getIdpSession: (issuer: string) => IdpSessionState;
  setIdpSession: (issuer: string, updates: Partial<IdpSessionState>) => void;
  clearIdpSession: (issuer: string) => void;
  clearEnterpriseManagedResourceServers: () => void;
}

/**
 * Mutable in-memory OAuth state keyed by server URL and IdP issuer.
 */
export class OAuthMemoryStore {
  private servers: Record<string, ServerOAuthState> = {};
  private idpSessions: Record<string, IdpSessionState> = {};

  constructor(initial?: OAuthPersistSnapshot) {
    if (initial) {
      this.replace(initial);
    }
  }

  getState(): OAuthStoreState {
    return {
      servers: this.servers,
      idpSessions: this.idpSessions,
      getServerState: (serverUrl: string) => {
        return this.servers[serverUrl] || {};
      },
      setServerState: (
        serverUrl: string,
        updates: Partial<ServerOAuthState>,
      ) => {
        this.servers = {
          ...this.servers,
          [serverUrl]: {
            ...this.servers[serverUrl],
            ...updates,
          },
        };
      },
      clearServerState: (serverUrl: string) => {
        const rest = { ...this.servers };
        delete rest[serverUrl];
        this.servers = rest;
      },
      getIdpSession: (issuer: string) => {
        return this.idpSessions[issuer] || {};
      },
      setIdpSession: (issuer: string, updates: Partial<IdpSessionState>) => {
        this.idpSessions = {
          ...this.idpSessions,
          [issuer]: {
            ...this.idpSessions[issuer],
            ...updates,
          },
        };
      },
      clearIdpSession: (issuer: string) => {
        const rest = { ...this.idpSessions };
        delete rest[issuer];
        this.idpSessions = rest;
      },
      clearEnterpriseManagedResourceServers: () => {
        const rest = { ...this.servers };
        for (const [url, serverState] of Object.entries(this.servers)) {
          if (serverState.enterpriseManaged === true) {
            delete rest[url];
          }
        }
        this.servers = rest;
      },
    };
  }

  snapshot(): OAuthPersistSnapshot {
    return {
      servers: { ...this.servers },
      idpSessions: { ...this.idpSessions },
    };
  }

  replace(snapshot: OAuthPersistSnapshot): void {
    this.servers = { ...(snapshot.servers ?? {}) };
    this.idpSessions = { ...(snapshot.idpSessions ?? {}) };
  }
}
