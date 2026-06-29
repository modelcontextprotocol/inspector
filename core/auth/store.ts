/**
 * OAuth store factory using Zustand.
 * Creates a store with any storage adapter (file, remote, sessionStorage).
 */

import { createStore } from "zustand/vanilla";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { IdpSessionState, OAuthClientRegistrationKind } from "./storage.js";

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
 * Zustand store state (all servers)
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
 * Creates a Zustand store for OAuth state with the given storage adapter.
 * The storage adapter handles persistence (file, remote HTTP, sessionStorage, etc.).
 *
 * @param storage - Zustand storage adapter (from createJSONStorage)
 * @returns Zustand store instance
 */
export function createOAuthStore(
  storage: ReturnType<typeof createJSONStorage>,
) {
  return createStore<OAuthStoreState>()(
    persist(
      (set, get) => ({
        servers: {},
        idpSessions: {},
        getServerState: (serverUrl: string) => {
          return get().servers[serverUrl] || {};
        },
        setServerState: (
          serverUrl: string,
          updates: Partial<ServerOAuthState>,
        ) => {
          set((state) => ({
            servers: {
              ...state.servers,
              [serverUrl]: {
                ...state.servers[serverUrl],
                ...updates,
              },
            },
          }));
        },
        clearServerState: (serverUrl: string) => {
          set((state) => {
            const rest = { ...state.servers };
            delete rest[serverUrl];
            return { servers: rest };
          });
        },
        getIdpSession: (issuer: string) => {
          return get().idpSessions[issuer] || {};
        },
        setIdpSession: (issuer: string, updates: Partial<IdpSessionState>) => {
          set((state) => ({
            idpSessions: {
              ...state.idpSessions,
              [issuer]: {
                ...state.idpSessions[issuer],
                ...updates,
              },
            },
          }));
        },
        clearIdpSession: (issuer: string) => {
          set((state) => {
            const rest = { ...state.idpSessions };
            delete rest[issuer];
            return { idpSessions: rest };
          });
        },
        clearEnterpriseManagedResourceServers: () => {
          set((state) => {
            const rest = { ...state.servers };
            for (const [url, serverState] of Object.entries(state.servers)) {
              if (serverState.enterpriseManaged === true) {
                delete rest[url];
              }
            }
            return { servers: rest };
          });
        },
      }),
      {
        name: "mcp-inspector-oauth",
        storage,
      },
    ),
  );
}
