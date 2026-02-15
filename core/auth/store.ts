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

/**
 * OAuth state for a single server
 */
export interface ServerOAuthState {
  clientInformation?: OAuthClientInformation;
  preregisteredClientInformation?: OAuthClientInformation;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  scope?: string;
  serverMetadata?: OAuthMetadata;
}

/**
 * Zustand store state (all servers)
 */
export interface OAuthStoreState {
  servers: Record<string, ServerOAuthState>;
  getServerState: (serverUrl: string) => ServerOAuthState;
  setServerState: (serverUrl: string, state: Partial<ServerOAuthState>) => void;
  clearServerState: (serverUrl: string) => void;
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
            const { [serverUrl]: _, ...rest } = state.servers;
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
