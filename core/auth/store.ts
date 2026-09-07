/**
 * In-memory OAuth state store (servers + IdP sessions).
 * Persisted via `OAuthStorageBase` + `OAuthPersistBackend` backends.
 */

import type {
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadata,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/client";
import type {
  IdpSessionState,
  OAuthClientRegistrationKind,
} from "./storage.js";
import type { OAuthPersistSnapshot } from "./oauth-persist.js";

/**
 * OAuth credentials bound to a single authorization-server `issuer` (SEP-2352).
 *
 * Client identifiers are unique to the AS that issued them (RFC 6749 §2.2), and
 * tokens minted by one AS must never be presented to another. The SDK v2 stamps
 * `issuer` on the objects it saves and passes `ctx.issuer` on every read/write;
 * this record is how the Inspector keys that state per authorization server so a
 * resource that migrates between ASes re-registers/re-authorizes cleanly instead
 * of reusing mismatched credentials.
 */
export interface IssuerBoundOAuthState {
  clientInformation?: OAuthClientInformation;
  /** Set when {@link clientInformation} is saved — DCR vs CIMD. */
  clientRegistrationKind?: OAuthClientRegistrationKind;
  tokens?: OAuthTokens;
}

/**
 * OAuth state for a single server.
 *
 * Issuer-bound credentials (client info + tokens) live under {@link byIssuer},
 * keyed by AS `issuer` (SEP-2352). Per-server / per-flow state (code verifier,
 * discovered metadata, discovery state, static client info, EMA marker, and the
 * requested-scope seed) is issuer-independent and stays at the top level.
 *
 * The bare top-level {@link clientInformation} / {@link tokens} fields are the
 * **legacy unkeyed fallback**: a pre-1625 snapshot deserializes with credentials
 * here and no `issuer` stamp. Reads fall back to them when {@link byIssuer} has
 * no entry; the first issuer-stamped save promotes them into {@link byIssuer} and
 * clears the fallback (lazy migration — see `OAuthStorageBase`). New saves never
 * write the bare fields.
 */
export interface ServerOAuthState {
  /** Per-issuer credentials (SEP-2352). */
  byIssuer?: Record<string, IssuerBoundOAuthState>;
  /** Most-recently-saved issuer — answers ctx-less reads (per-request bearer token). */
  activeIssuer?: string;
  preregisteredClientInformation?: OAuthClientInformation;
  codeVerifier?: string;
  scope?: string;
  serverMetadata?: OAuthMetadata;
  /** RFC 9728/8414 discovery cache; persisted alongside {@link codeVerifier} (SEP-2352 callback-leg binding). */
  discoveryState?: OAuthDiscoveryState;
  /** Set when resource tokens were minted via EMA (legs 2–3). */
  enterpriseManaged?: boolean;

  /** @deprecated Legacy unkeyed fallback — see {@link ServerOAuthState}. */
  clientInformation?: OAuthClientInformation;
  /** @deprecated Legacy unkeyed fallback — see {@link ServerOAuthState}. */
  clientRegistrationKind?: OAuthClientRegistrationKind;
  /** @deprecated Legacy unkeyed fallback — see {@link ServerOAuthState}. */
  tokens?: OAuthTokens;
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
